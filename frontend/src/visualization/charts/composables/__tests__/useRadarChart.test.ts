/**
 * 回归测试：雷达轴名点击依赖 radar 根级 triggerEvent。
 * ECharts RadarModel 从 radar 根读取 triggerEvent 并下发到各指示器轴模型，
 * axisName 节点只承载样式——写在 axisName 里的 triggerEvent 静默失效
 * （轴名元素保持 silent，点击永不派发），曾导致「点轴名 → POI 图层 +
 * 多点呼吸」交互整体不可用（见 2026-08-29 交接文档 §3）。
 * 策略与 useChartBase.test.ts 一致：mock useECharts 捕获 getOption，不依赖真实渲染。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'

interface Captured {
  getOption: (() => Record<string, unknown>) | null
  onClick: ((params: { componentType: string; name: string }) => void) | null
}

// vi.hoisted 保证变量在 vi.mock 工厂提升后可用
const { captured } = vi.hoisted<{ captured: Captured }>(() => ({
  captured: { getOption: null, onClick: null },
}))

vi.mock('@/visualization/composables/useECharts', () => ({
  useECharts: (opts: {
    getOption: () => Record<string, unknown>
    onClick?: (params: { componentType: string; name: string }) => void
  }) => {
    captured.getOption = opts.getOption
    captured.onClick = opts.onClick ?? null
    return { chartRef: { value: null }, updateChart: vi.fn(), getInstance: () => null }
  },
}))

import { useRadarChart } from '../useRadarChart'

// 容器尺寸 ≥10 才会构建 option（不足时走 100ms 重试分支）
function createChartRef() {
  const el = document.createElement('div')
  Object.defineProperty(el, 'clientWidth', { value: 320 })
  Object.defineProperty(el, 'clientHeight', { value: 320 })
  return ref<HTMLElement | null>(el)
}

function setupRadar() {
  return useRadarChart({
    chartRef: createChartRef(),
    getScoreAreaRef: () => null,
    getProps: () => ({
      xiaoqu: {
        id: 'x1',
        name: '测试小区',
        lng: 108.6,
        lat: 21.9,
        score: 83,
        breakdown: { hospital: 50 },
      },
      selectedTypes: ['hospital'],
      facilityPoi: {},
    }),
    emit: vi.fn(),
  })
}

describe('useRadarChart 雷达 option（轴名点击契约）', () => {
  it('radar 根级 triggerEvent 必须为 true（写在 axisName 内不生效）', () => {
    setupRadar()
    const option = captured.getOption!() as { radar?: { triggerEvent?: boolean } }
    expect(option.radar?.triggerEvent).toBe(true)
  })

  it('轴名保留可点视觉暗示（cursor: pointer）', () => {
    setupRadar()
    const option = captured.getOption!() as {
      radar?: { axisName?: { cursor?: string } }
    }
    expect(option.radar?.axisName?.cursor).toBe('pointer')
  })
})

describe('useRadarChart 尺寸重试上限', () => {
  it('容器不存在时最多重排 10 次即放弃（计数器在 composable 作用域）', () => {
    // 阳性对照：旧实现把计数器写在 DOM 节点上，container=null 时每轮都从
    // undefined 起算 ⇒ 15 次调用会排 15 个定时器（无限自排）
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    try {
      captured.getOption = null
      useRadarChart({
        chartRef: ref<HTMLElement | null>(null),
        getScoreAreaRef: () => null,
        getProps: () => ({
          xiaoqu: null,
          selectedTypes: ['hospital'],
          facilityPoi: {},
        }),
        emit: vi.fn(),
      })
      const build = captured.getOption!
      for (let i = 0; i < 15; i++) build()
      expect(setTimeoutSpy).toHaveBeenCalledTimes(10)
    } finally {
      setTimeoutSpy.mockRestore()
      vi.useRealTimers()
    }
  })
})

describe('useRadarChart 清理侧（W8：三条变异各必红）', () => {
  /** 可变尺寸容器：clientWidth/Height 走 getter，便于用例中途"变大/变小" */
  function sizeableChartRef() {
    const el = document.createElement('div')
    let w = 0
    let h = 0
    Object.defineProperty(el, 'clientWidth', { get: () => w, configurable: true })
    Object.defineProperty(el, 'clientHeight', { get: () => h, configurable: true })
    return {
      ref: ref<HTMLElement | null>(el),
      setSize: (nextW: number, nextH: number) => {
        w = nextW
        h = nextH
      },
    }
  }

  function setupWithSize(sizeable: ReturnType<typeof sizeableChartRef>) {
    useRadarChart({
      chartRef: sizeable.ref,
      getScoreAreaRef: () => null,
      getProps: () => ({
        xiaoqu: null,
        selectedTypes: ['hospital'],
        facilityPoi: {},
      }),
      emit: vi.fn(),
    })
    return captured.getOption!
  }

  it('🔴 尺寸重试不叠定时器：重复调用只留一个待触发定时器（删 clearTimeout 即红）', () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    try {
      const sizeable = sizeableChartRef()
      sizeable.setSize(0, 0) // 尺寸不足 → 走重试分支
      const build = setupWithSize(sizeable)

      build()
      build()
      // 删掉 `if (retryTimer) clearTimeout(retryTimer)` ⇒ 两个定时器同时挂起，此处会是 2
      expect(vi.getTimerCount()).toBe(1)
      expect(setTimeoutSpy).toHaveBeenCalledTimes(2) // 每次都重排（但只保留最后一个）
    } finally {
      setTimeoutSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('🔴 尺寸恢复后重试计数归零：再次变小仍会重试（删归零即红）', () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    try {
      const sizeable = sizeableChartRef()
      sizeable.setSize(0, 0)
      const build = setupWithSize(sizeable)

      for (let i = 0; i < 10; i++) build() // 用满 10 次重试额度
      sizeable.setSize(320, 320)
      build() // 尺寸恢复 ⇒ 应当归零计数
      sizeable.setSize(0, 0)

      const before = setTimeoutSpy.mock.calls.length
      build()
      // 删掉 `radarRetryCount = 0` ⇒ 计数停在 10 ⇒ 这次直接放弃渲染，不再排定时器
      expect(setTimeoutSpy.mock.calls.length).toBe(before + 1)
    } finally {
      setTimeoutSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('🔴 卸载后不再重试：onBeforeUnmount 清掉待触发定时器（删即红）', () => {
    vi.useFakeTimers()
    try {
      const sizeable = sizeableChartRef()
      sizeable.setSize(0, 0)
      // onBeforeUnmount 只在组件上下文有效 ⇒ 用真组件挂载（独立调用时该钩子被 Vue 丢弃）
      const Harness = defineComponent({
        setup() {
          useRadarChart({
            chartRef: sizeable.ref,
            getScoreAreaRef: () => null,
            getProps: () => ({ xiaoqu: null, selectedTypes: ['hospital'], facilityPoi: {} }),
            emit: vi.fn(),
          })
          return () => h('div')
        },
      })
      const wrapper = mount(Harness)
      captured.getOption!() // 触发一次重试排期
      expect(vi.getTimerCount()).toBeGreaterThan(0)

      wrapper.unmount()
      // 删掉 onBeforeUnmount 清理 ⇒ 定时器仍在，卸载后还会调 renderRadar
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useRadarChart 轴名点亮语义（互斥）', () => {
  /** 经 echarts onClick 通道点轴名（label → type 反查在 composable 内部） */
  function setupTwoTypes() {
    const emit = vi.fn()
    const radar = useRadarChart({
      chartRef: ref<HTMLElement | null>(null),
      getScoreAreaRef: () => null,
      getProps: () => ({
        xiaoqu: null,
        selectedTypes: ['hospital', 'park'],
        facilityPoi: { hospital: [], park: [] },
      }),
      emit,
    })
    const clickAxis = (label: string) => captured.onClick!({ componentType: 'radar', name: label })
    return { radar, emit, clickAxis }
  }

  it('点一根轴点亮；点另一根先熄旧再点新（集合不叠加）', () => {
    const { radar, emit, clickAxis } = setupTwoTypes()
    clickAxis('医院')
    expect([...radar.activeFacilityTypes.value]).toEqual(['hospital'])
    expect(emit).toHaveBeenCalledWith(
      'show-facility-layer',
      expect.objectContaining({ type: 'hospital' })
    )

    clickAxis('公园')
    expect([...radar.activeFacilityTypes.value]).toEqual(['park'])
    // 旧类型被显式熄掉，再点亮新类型——与页面 activeBreathTypes 的整体替换同终态
    expect(emit).toHaveBeenCalledWith('hide-facility-layer', 'hospital')
    expect(emit).toHaveBeenCalledWith(
      'show-facility-layer',
      expect.objectContaining({ type: 'park' })
    )
  })

  it('阳性对照：再点已点亮的轴 = 熄灭且集合清空（旧并集语义下这里会残留幻影）', () => {
    const { radar, emit, clickAxis } = setupTwoTypes()
    clickAxis('医院')
    clickAxis('公园')
    emit.mockClear()
    clickAxis('公园')
    expect([...radar.activeFacilityTypes.value]).toEqual([])
    expect(emit).toHaveBeenCalledWith('hide-facility-layer', 'park')
    expect(emit).not.toHaveBeenCalledWith('show-facility-layer', expect.anything())
  })
})
