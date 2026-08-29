/**
 * 回归测试：雷达轴名点击依赖 radar 根级 triggerEvent。
 * ECharts RadarModel 从 radar 根读取 triggerEvent 并下发到各指示器轴模型，
 * axisName 节点只承载样式——写在 axisName 里的 triggerEvent 静默失效
 * （轴名元素保持 silent，点击永不派发），曾导致「点轴名 → POI 图层 +
 * 多点呼吸」交互整体不可用（见 2026-08-29 交接文档 §3）。
 * 策略与 useChartBase.test.ts 一致：mock useECharts 捕获 getOption，不依赖真实渲染。
 */
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

interface Captured {
  getOption: (() => Record<string, unknown>) | null
}

// vi.hoisted 保证变量在 vi.mock 工厂提升后可用
const { captured } = vi.hoisted<{ captured: Captured }>(() => ({
  captured: { getOption: null },
}))

vi.mock('@/visualization/composables/useECharts', () => ({
  useECharts: (opts: { getOption: () => Record<string, unknown> }) => {
    captured.getOption = opts.getOption
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
