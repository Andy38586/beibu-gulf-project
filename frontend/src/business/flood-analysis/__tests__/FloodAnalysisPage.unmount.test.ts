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
  const getWaterArea = vi.fn().mockResolvedValue([
    [108.5, 21.7],
    [108.6, 21.8],
  ])
  return {
    mockManager,
    getWaterArea,
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
 * v5（2026-09-21）追加 addGeoTIFFLayer/removeLayer：地形山影虽改为「随底图默认加载的
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

    // ② 渲染状态清干净：三个**业务**图层移除（地形山影不属业务图层，见 ③）
    const removed = h.mockManager.remove.mock.calls.map((c) => c[0])
    expect(removed).toContain('flood-water-surface')
    expect(removed).toContain('flood-area')
    expect(removed).toContain('flood-facilities')

    // ③ 地形山影：随底图默认加载，但**仍经** businessLayerManager 注册（单一事实源），
    //    卸载时一并移除。它不出现在图层面板是靠 listed:false，不是靠绕过 BLM
    expect(removed).toContain('flood-dem-hillshade')

    // ④ 定时器清干净：推进很久也不该再有图层写入（水面防抖已 clear）
    h.mockManager.updateData.mockClear()
    vi.advanceTimersByTime(5000)
    await flushPromises()
    expect(h.mockManager.updateData).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('地形山影经 BLM 注册（单一事实源），以 listed:false + locked:true 表达「随底图默认加载、不列表、不可关」', async () => {
    const wrapper = shallowMount(FloodAnalysisPage)

    const mapStore = useMapStore()
    mapStore.currentRenderer = WATER_CAPABLE_RENDERER
    await flushPromises()

    // 注册必须经 businessLayerManager —— 若绕过它直调渲染器，图层就出现了第二个
    // 事实源（BLM 不知道它存在），引擎切换不会重绘、卸载也不会清理
    const call = h.mockManager.register.mock.calls.find((c) => c[0] === 'flood-dem-hillshade')
    expect(call).toBeDefined()

    const descriptor = call![1] as {
      visible?: boolean
      listed?: boolean
      locked?: boolean
      layerType?: string
    }
    // 默认开：与底图一同加载
    expect(descriptor.visible).toBe(true)
    // 不列表：面板里没有这一格
    expect(descriptor.listed).toBe(false)
    // 不可关：它是底图固有部分
    expect(descriptor.locked).toBe(true)
    expect(descriptor.layerType).toBe('geotiff')

    // ⚠ 此处不断言渲染器的 addGeoTIFFLayer：本用例把 BLM 整体替身了，
    //   实际分派链路（BLM → geotiff adapter → renderer）不在本用例覆盖范围内。
    //   「渲染确实发生」由 core/map/layerAdapters 与 BusinessLayerManager 的测试负责。

    wrapper.unmount()
    await flushPromises()

    // 卸载：经 BLM 移除，不残留到别的路由
    expect(h.mockManager.remove.mock.calls.map((c) => c[0])).toContain('flood-dem-hillshade')
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
})
