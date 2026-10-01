// @vitest-environment jsdom
/**
 * FloodAnalysisPage 卸载守卫回归测试
 *
 * ── v4-S3 重写（2026-09-18）─────────────────────────────────────────────────
 * 原测试锁定的是「页面持有请求」时代的两个不变量：卸载时 abort 在途请求、
 * 迟到响应不复活图层。请求归属收进 `WaterLevelProfilePanel` 后，这两条的前提
 * 全部变了 —— 页面**不再持有任何分析请求**，它的 signal 只覆盖水面/DEM 加载。
 *
 * 但"卸载守卫"这件事本身在 v4 里**更重要**了，只是不变量换成了新的三条：
 *   ① 卸载**不得取消后端任务**（保活语义——用户拖进 dock 就是为了让它跑完）
 *   ② 卸载**不得**残留定时器/图层（渲染状态必须清干净，否则泄漏到别的路由）
 *   ③ 迟到响应不复活图层（`unmounted` 标志仍是防线，这条没变）
 *
 * 🔴 为什么必须钉住 ①：这是 v4 唯一"看起来像 bug 的正确行为"——
 *    将来任何人在 onUnmounted 里补一句 `taskStore.cancel()` 都会让拖拽保活当场废掉，
 *    而且不会被任何其它测试发现（任务照常能跑，只是被取消了）。
 *
 * 本测试用 shallowMount（TaskPanelSlot / WaterLevelProfilePanel 均被 stub），
 * 因此只验证**页面自身**的卸载行为，不涉及面板内部——面板侧另有测试。
 * 仅 mock 外部依赖（manager、floodAdapter、vue-router、taskStore），不 mock 被测组件内部。
 */
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFloodStore } from '@/stores'
import { useMapStore } from '@/stores'

const h = vi.hoisted(() => {
  const mockManager = {
    register: vi.fn(),
    remove: vi.fn(),
    has: vi.fn(() => false),
    updateData: vi.fn(),
    reapplyAll: vi.fn(),
    removeAllFromRenderer: vi.fn(),
  }
  const getWaterArea = vi.fn(
    // 带形参声明：本用例族要断言**传进来的到底是不是一个真 signal**，
    // 无参 vi.fn() 会让 mock.calls 推成空元组，取 [0] 在 typecheck 阶段就写不出来
    async (_signal?: AbortSignal): Promise<[number, number][]> => [
      [108.5, 21.7],
      [108.6, 21.8],
    ]
  )
  return {
    mockManager,
    getWaterArea,
    /** showWarning 替身：水域失败的告警跨路由可见，必须能断言它弹 / 不弹 */
    showWarning: vi.fn(),
    /** taskStore.cancel —— 卸载时绝不能碰（保活语义） */
    cancelSlot: vi.fn(),
    setDocked: vi.fn(),
    getSlot: vi.fn(() => null),
  }
})

vi.mock('@/core/map/composables/useBusinessLayers', () => ({
  useBusinessLayers: vi.fn(() => ({ manager: h.mockManager })),
}))

vi.mock('@/services/adapters/floodAdapter', () => ({
  floodAdapter: {
    getWaterArea: h.getWaterArea,
    // 页面不该再调这两个（请求已归面板）；若被调用说明架构回退
    getFloodAnalysis: vi.fn(() => new Promise(() => {})),
    getImpactAssessment: vi.fn(() => new Promise(() => {})),
    getFloodStatistics: vi.fn(() => new Promise(() => {})),
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { engine: 'ol' }, params: {}, query: {} }),
  onBeforeRouteLeave: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}))

// 只替身 showWarning（其余出口保持真实）：告警是唯一能观测到"卸载后还在报"的对外面
vi.mock('@/shared/utils/errorHandler', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/shared/utils/errorHandler')>()
  return { ...mod, showWarning: h.showWarning }
})

// taskStore 打桩：页面只应读 getSlot / 写 setDocked，**绝不**调 cancel
vi.mock('@/stores', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/stores')>()
  return {
    ...mod,
    useTaskStore: () => ({
      getSlot: h.getSlot,
      setDocked: h.setDocked,
      cancel: h.cancelSlot,
      submitAndWait: vi.fn(),
    }),
  }
})

import FloodAnalysisPage from '../FloodAnalysisPage.vue'

/**
 * 能通过 `isWater3DCapable` 的假渲染器（需含 addWaterSurface —— 能力守卫按方法存在性判定）。
 *
 * 基础能力」，但仍经 businessLayerManager 注册（单一事实源，04 清单 A4），
 * 实际渲染由 BLM 经 geotiff adapter 分派到渲染器，故渲染器替身需具备这两个方法。
 */
const WATER_CAPABLE_RENDERER = {
  getType: () => 'ol',
  addWaterSurface: vi.fn(),
  addGeoTIFFLayer: vi.fn(),
  removeLayer: vi.fn(),
} as never

describe('FloodAnalysisPage 卸载守卫（v4-S3）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    h.mockManager.has.mockReturnValue(false)
    h.getSlot.mockReturnValue(null)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('卸载不取消后端任务，且清理全部业务图层与定时器', async () => {
    vi.useFakeTimers()
    const wrapper = shallowMount(FloodAnalysisPage)

    // 设置 renderer：触发 registerFloodLayers（水面/DEM 注册路径）
    const mapStore = useMapStore()
    mapStore.currentRenderer = WATER_CAPABLE_RENDERER
    await flushPromises()

    // 水面图层应已注册（水域坐标已 mock 返回）
    expect(h.mockManager.register.mock.calls.some((c) => c[0] === 'flood-water-surface')).toBe(true)

    // 触发水位变化 → 页面侧的水面高度防抖定时器排上
    useFloodStore().setWaterLevel(8)
    await flushPromises()

    // ── 卸载 ────────────────────────────────────────────────────────────────
    wrapper.unmount()
    await flushPromises()

    // ① 🔴 保活：绝不取消后端任务
    expect(h.cancelSlot).not.toHaveBeenCalled()

    // ② 渲染状态清干净：**业务**图层移除
    const removed = h.mockManager.remove.mock.calls.map((c) => c[0])
    expect(removed).toContain('flood-water-surface')
    // flood-area / flood-facilities 是**按需注册**的（首次操作滑块才注册），本用例未触发
    // ⇒ 它们不在归属册里 ⇒ 不该被 remove。旧实现无条件 remove 四个 id（在清压根不存在的键），
    // 改成归属约束后，这里刻意把断言**收紧**成「只清在册的」——比原来更准，而不是更松。
    expect(removed).not.toContain('flood-area')
    expect(removed).not.toContain('flood-facilities')

    // ④ 定时器清干净：推进很久也不该再有图层写入（水面防抖已 clear）
    h.mockManager.updateData.mockClear()
    vi.advanceTimersByTime(5000)
    await flushPromises()
    expect(h.mockManager.updateData).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('卸载后水位变化不再产生任何图层写入（迟到响应不复活图层）', async () => {
    const wrapper = shallowMount(FloodAnalysisPage)

    const mapStore = useMapStore()
    mapStore.currentRenderer = WATER_CAPABLE_RENDERER
    await flushPromises()

    wrapper.unmount()
    await flushPromises()

    // 卸载后再改水位：watch 仍在（组件已销毁但 effect 应已 stop）或 unmounted 守卫应拦住
    h.mockManager.updateData.mockClear()
    h.mockManager.register.mockClear()
    useFloodStore().setWaterLevel(9)
    await new Promise((r) => setTimeout(r, 300))
    await flushPromises()

    expect(h.mockManager.updateData).not.toHaveBeenCalled()
    expect(h.mockManager.register).not.toHaveBeenCalled()
  })

  /**
   * R2-06/03（2026-09-24 复查）· 取消链曾经**整体空转**：页面只 `getCurrentSignal()` 读，
   * 而本页没有任何 `createSignal()` 写入点 ⇒ 恒返回 undefined。于是 onUnmounted 里
   * "取消在途请求"这句注释所描述的机制根本不存在（04-D4 防御壳化），且失败告警会在
   * 用户已经离开本页之后弹到别的路由上。下面三格分别钉：信号是真的 / 卸载会 abort /
   * abort 后不弹（同一失败路径未 abort 时必须弹，作阳性对照）。
   */
  it('水域坐标请求收到真实 AbortSignal（曾恒为 undefined）', async () => {
    const wrapper = shallowMount(FloodAnalysisPage)
    useMapStore().currentRenderer = WATER_CAPABLE_RENDERER
    await flushPromises()

    const calls = h.getWaterArea.mock.calls
    const call = calls[calls.length - 1]
    expect(call).toBeDefined()
    expect(call![0]).toBeInstanceOf(AbortSignal)
    wrapper.unmount()
  })

  it('卸载 abort 在途的水域坐标请求', async () => {
    let inflight: AbortSignal | undefined
    h.getWaterArea.mockImplementationOnce(
      (signal?: AbortSignal) =>
        new Promise<[number, number][]>(() => {
          inflight = signal // 永不落定：模拟卸载发生时请求仍在途
        })
    )

    const wrapper = shallowMount(FloodAnalysisPage)
    useMapStore().currentRenderer = WATER_CAPABLE_RENDERER
    await flushPromises()

    expect(inflight).toBeInstanceOf(AbortSignal)
    expect(inflight!.aborted).toBe(false)

    wrapper.unmount()
    expect(inflight!.aborted).toBe(true)
  })

  it('未 abort 的失败必须弹告警（阳性对照）；abort 之后的同形态失败不得弹', async () => {
    h.getWaterArea.mockRejectedValueOnce(new Error('水域坐标取数失败'))
    const beforeUnmount = shallowMount(FloodAnalysisPage)
    useMapStore().currentRenderer = WATER_CAPABLE_RENDERER
    await flushPromises()
    expect(h.showWarning).toHaveBeenCalledTimes(1)
    beforeUnmount.unmount()

    h.showWarning.mockClear()
    let reject!: (e: Error) => void
    h.getWaterArea.mockImplementationOnce(
      () =>
        new Promise<[number, number][]>((_resolve, rej) => {
          reject = rej
        })
    )
    const afterUnmount = shallowMount(FloodAnalysisPage)
    useMapStore().currentRenderer = WATER_CAPABLE_RENDERER
    await flushPromises()

    afterUnmount.unmount() // ← 此处 abort 在途请求
    reject(new Error('水域坐标取数失败'))
    await flushPromises()

    expect(h.showWarning).not.toHaveBeenCalled()
  })
})
