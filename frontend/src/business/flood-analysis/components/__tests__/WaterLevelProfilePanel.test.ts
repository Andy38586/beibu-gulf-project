// @vitest-environment jsdom
/**
 * WaterLevelProfilePanel 请求归属测试（v4-S3）
 *
 * ── 本测试钉住的核心契约 ────────────────────────────────────────────────────
 * v4-S3 把请求发起权从页面搬进本面板，并做了**两条路径**的区分
 * （理由见 useFloodRequest 头注释）：
 *
 *   ① 滑块拖动 / 点刻度 / 恢复 → **直连**（`viaTask = false`）
 *   ② 拖入 dock 后的后台续跑   → **任务**（`viaTask = true`）
 *
 * 🔴 为什么必须钉住 ①：flood 是连续手势（拖一次可能 5~10 轮），走队列会打满
 *    后端并发上限为 1、容量为 8 的队列，滑块会卡死。将来若有人图省事把滑块
 *    也改成走任务，用户体验会当场崩掉——而功能测试全绿（任务确实在跑，
 *    只是排队排到天荒地老）。
 *
 * 🔴 为什么必须钉住「卸载不取消任务」：这是保活语义的底线。
 *
 * 仅 mock 外部依赖（floodAdapter / echarts / 滑块专注），不 mock 被测组件内部。
 */
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  /** 直连路径的调用记录 */
  directCalls: [] as number[],
  /** 任务路径的调用记录 */
  taskCalls: [] as number[],
  cancelSpy: vi.fn(),
  chart: {
    setOption: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  },
}))

vi.mock('echarts/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('echarts/core')>()
  return { ...mod, init: vi.fn(() => h.chart), use: vi.fn() }
})
vi.mock('echarts/charts', () => ({ LineChart: {}, BarChart: {}, RadarChart: {} }))
vi.mock('echarts/components', () => ({
  GridComponent: {},
  LegendComponent: {},
  TitleComponent: {},
  TooltipComponent: {},
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

vi.mock('@/core/layout/useSliderFocus', () => ({
  useSliderFocus: () => ({ beginSliderFocus: vi.fn(), endSliderFocus: vi.fn() }),
}))

vi.mock('@/shared/composables/useApiRequest', async () => {
  const { ref } = await import('vue')
  return {
    useApiRequest: () => ({
      apiRequest: h.apiRequest,
      token: ref(''),
      setToken: vi.fn(),
      clearToken: vi.fn(),
    }),
  }
})

// floodAdapter：直连路径的观测点
vi.mock('@/services/adapters/floodAdapter', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/services/adapters/floodAdapter')>()
  return {
    ...mod,
    floodAdapter: {
      getWaterArea: vi.fn().mockResolvedValue([[108.5, 21.7]]),
      getFloodAnalysis: vi.fn(async (level: number) => {
        h.directCalls.push(level)
        return { features: [], statistics: {}, riskLevel: '无风险', actualWaterLevel: level }
      }),
      getFloodStatistics: vi.fn().mockResolvedValue({}),
      getImpactAssessment: vi.fn().mockResolvedValue({
        affectedFacilities: [],
        totalLoss: 0,
      }),
    },
  }
})

// taskStore：任务路径的观测点
vi.mock('@/stores', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/stores')>()
  return {
    ...mod,
    useTaskStore: () => ({
      getSlot: vi.fn(() => null),
      setDocked: vi.fn(),
      cancel: h.cancelSpy,
      submitAndWait: vi.fn(async (o: { params: { waterLevel: number } }) => {
        h.taskCalls.push(o.params.waterLevel)
        // 模拟任务成功：返回淹没范围（无 statistics —— 真实任务域就是这样）
        return {
          slot: { status: 'done', result: { features: [], riskLevel: '无风险' } },
        }
      }),
    }),
  }
})

import { FLOOD_ANALYSIS_DELAY } from '../../composables/useFloodRequest'
import WaterLevelProfilePanel from '../WaterLevelProfilePanel.vue'

describe('WaterLevelProfilePanel 请求归属（v4-S3）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    h.directCalls.length = 0
    h.taskCalls.length = 0
    h.apiRequest.mockResolvedValue([{ id: 'p1', name: '剖面1', points: [[108.5, 21.7, 0]] }])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('滑块拖动走直连（viaTask=false），不打后端任务队列', async () => {
    vi.useFakeTimers()
    const { useFloodStore } = await import('@/stores')
    const wrapper = shallowMount(WaterLevelProfilePanel)
    await flushPromises()

    // 首屏已跑过一次（水位 0，直连）
    expect(h.directCalls).toEqual([0])

    // 模拟滑块拖动：连续多次改水位
    const store = useFloodStore()
    store.setWaterLevel(2)
    store.setWaterLevel(4)
    store.setWaterLevel(6)
    await flushPromises()

    // 防抖未到：不应有新请求
    expect(h.directCalls).toEqual([0])

    // 推进防抖定时器 → 只发一次（连续拖动被合并）
    vi.advanceTimersByTime(FLOOD_ANALYSIS_DELAY + 10)
    await flushPromises()
    expect(h.directCalls).toEqual([0, 6])

    // 🔴 关键断言：滑块路径绝不碰任务队列
    expect(h.taskCalls).toEqual([])

    wrapper.unmount()
    vi.useRealTimers()
  })

  /**
   * 🔴 2026-09-19 语义修正后的行为（替换原「docked 时滑块不发起请求」用例）。
   *
   * 原用例固化了**错误行为**：它假设 docked = 面板不在视口内、用户拖不到。
   * 用户澄清后：`docked` 只表示"任务让位排队"，**面板始终在原位可见可交互**，
   * 所以滑块必须照常生效（否则用户面对一个"活着但不响应"的面板）。
   *
   * ⚠️ 教训（项目已有先例）：**测试固化 bug 比没测试更危险** ——
   *    写断言前先问"这个行为是需求还是实现巧合"。
   */
  it('滑块始终生效：任务让位排队不影响面板交互（2026-09-19 语义修正）', async () => {
    vi.useFakeTimers()
    const { useFloodStore } = await import('@/stores')
    const store = useFloodStore()

    const wrapper = shallowMount(WaterLevelProfilePanel)
    await flushPromises()
    const baseline = h.directCalls.length

    // 任务让位排队（store 侧 setDocked 只影响导航环，不影响本面板）
    store.setWaterLevel(7)
    await flushPromises()
    vi.advanceTimersByTime(FLOOD_ANALYSIS_DELAY + 10)
    await flushPromises()

    // 面板仍在视口内 ⇒ 滑块变化必须照常发起请求
    expect(h.directCalls.length).toBeGreaterThan(baseline)

    wrapper.unmount()
    vi.useRealTimers()
  })

  it('stateRestored=true 时挂载不自动跑首屏（快照已有数据）', async () => {
    const wrapper = shallowMount(WaterLevelProfilePanel, { props: { stateRestored: true } })
    await flushPromises()

    expect(h.directCalls).toEqual([])

    wrapper.unmount()
  })

  it('卸载不取消后端任务（保活语义）', async () => {
    const { useFloodStore } = await import('@/stores')
    const wrapper = shallowMount(WaterLevelProfilePanel)
    await flushPromises()

    // 制造一次在途请求（直连）
    useFloodStore().setWaterLevel(3)
    await flushPromises()

    wrapper.unmount()
    await flushPromises()

    // 🔴 绝不调 taskStore.cancel —— 用户把面板拖进 dock 就是为了让它继续跑
    expect(h.cancelSpy).not.toHaveBeenCalled()
  })

  it('注入的渲染回调在请求落地后被调用', async () => {
    const analysis = vi.fn()
    const impact = vi.fn()
    const waterSurface = vi.fn()

    const wrapper = shallowMount(WaterLevelProfilePanel)
    // 页面在 onMounted 时注入
    ;(wrapper.vm as unknown as { registerRenderers: (r: unknown) => void }).registerRenderers({
      analysis,
      impact,
      waterSurface,
    })
    await flushPromises()

    expect(analysis).toHaveBeenCalled()
    expect(impact).toHaveBeenCalled()

    wrapper.unmount()
  })
})
