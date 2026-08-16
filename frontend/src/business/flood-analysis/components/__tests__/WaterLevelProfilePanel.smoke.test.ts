// @vitest-environment jsdom
/**
 * WaterLevelProfilePanel 挂载冒烟测试（2026-08-11：页面级 0 覆盖补充）
 * 目标：组件在真实 Pinia + mock echarts/请求 下可挂载/卸载不抛错：
 * - onMounted → loadProfiles（apiRequest）+ initChart（echarts.init）
 * - 卸载 → dispose + 移除 resize 监听
 * echarts 全模块 mock（jsdom 无 canvas，init 必须打桩）。
 */
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  chart: {
    setOption: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  },
}))

// 部分 mock echarts：保留真实导出（graphic 等纯对象），只覆盖 init/use（jsdom 无 canvas）
vi.mock('echarts/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('echarts/core')>()
  return { ...mod, init: vi.fn(() => h.chart), use: vi.fn() }
})

// echarts/charts 需含全链路引用的导出：组件经 @/core 入口导入 useSliderFocus 会连带加载
// @/core 桶 → AppLayout → @/visualization → RadarChart.vue → useRadarChart（echarts/charts 的
// LineChart/BarChart/RadarChart 三导出缺一即模块加载挂）
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

// mock useApiRequest 子模块（入口 @/shared 的 re-export 会解析到 mock）
vi.mock('@/shared/composables/useApiRequest', () => ({
  useApiRequest: () => ({ apiRequest: h.apiRequest }),
}))

import WaterLevelProfilePanel from '../WaterLevelProfilePanel.vue'

describe('WaterLevelProfilePanel 冒烟', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    // 组件期望 apiRequest 返回解包后的剖面数组（真实入口内部已 unwrap + zod 校验）
    h.apiRequest.mockResolvedValue([
      {
        id: 'p1',
        name: '剖面1',
        points: [
          [108.5, 21.7, 0],
          [108.6, 21.8, 1],
        ],
      },
    ])
  })

  it('挂载渲染成功、加载剖面数据、初始化图表且不抛错', async () => {
    const wrapper = shallowMount(WaterLevelProfilePanel)
    await flushPromises()
    expect(wrapper.exists()).toBe(true)
    // onMounted 触发剖面数据请求 + 图表初始化
    expect(h.apiRequest).toHaveBeenCalledWith(
      expect.stringContaining('terrain-profiles'),
      expect.anything()
    )
    expect(h.chart.setOption).toHaveBeenCalled()
    // 卸载：销毁图表实例
    wrapper.unmount()
    expect(h.chart.dispose).toHaveBeenCalled()
  })
})
