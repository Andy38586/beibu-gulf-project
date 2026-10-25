// @vitest-environment jsdom
/**
 * ForecastPage 降级角标（P1-1）：engine-fallback 必须可见，model / 旧响应（未标记）必须不渲染。
 *
 * 判据落在页面 DOM：页面是预测响应的真实渲染端（store.chart 绑定 LineChart/BarChart），
 * 只改类型或只改适配器返回值都不足以让本组变绿。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

const h = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  runInTransaction: vi.fn((fn: () => unknown) => fn()),
  startTransaction: vi.fn(() => 1),
  isTransactionValid: vi.fn(() => true),
  cancelAll: vi.fn(),
  updateForecastLayer: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ path: '/forecast' }),
  onBeforeRouteLeave: vi.fn(),
}))

vi.mock('@/business/forecast/composables/useForecastRequest', () => ({
  useForecastRequest: () => ({
    runInTransaction: h.runInTransaction,
    startTransaction: h.startTransaction,
    isTransactionValid: h.isTransactionValid,
    cancelAll: h.cancelAll,
  }),
}))

vi.mock('@/business/forecast/composables/useForecastLayer', () => ({
  useForecastLayer: () => ({
    updateForecastLayer: h.updateForecastLayer,
    renderer: { value: null },
  }),
}))

// 与 ForecastPage.smoke 同口径：适配器依赖的统一请求入口换成 mock，避免真实网络/认证副作用
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

import { useForecastStore } from '@/stores'

import ForecastPage from '../ForecastPage.vue'

/** 布局与面板壳子换成渲染插槽的轻量桩：只为让页面模板里的角标真正进 DOM */
const AppLayoutStub = { template: '<div><slot name="left" /><slot name="right" /></div>' }
const PanelStub = { template: '<div class="panel-stub"><slot /></div>' }

function mountPage() {
  return mount(ForecastPage, {
    global: {
      stubs: {
        AppLayout: AppLayoutStub,
        GCSPanel: PanelStub,
        StackSlot: true,
        LineChart: true,
        BarChart: true,
        ChartLoading: true,
        ForecastControlPanel: true,
        LayerControlPanel: true,
      },
    },
  })
}

describe('ForecastPage 降级角标（P1-1）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('降级响应渲染角标；模型响应不渲染（阴性对照）', async () => {
    const wrapper = mountPage()
    const store = useForecastStore()
    const badge = () => wrapper.find('[data-testid="forecast-fallback-badge-line"]')

    // 未标记（旧响应 / 文件透传指标）：不渲染
    expect(badge().exists()).toBe(false)

    store.chart.lineDataSource = 'engine-fallback'
    await nextTick()
    expect(badge().exists()).toBe(true)
    expect(badge().text()).toContain('趋势外推')

    // 模型路径：角标消失（正常路径布局零变化）
    store.chart.lineDataSource = 'model'
    await nextTick()
    expect(badge().exists()).toBe(false)

    wrapper.unmount()
  })

  it('柱图降级独立标记：仅柱图降级时只有柱图角标（不串到折线图）', async () => {
    const wrapper = mountPage()
    const store = useForecastStore()

    store.chart.lineDataSource = 'model'
    store.chart.barDataSource = 'engine-fallback'
    await nextTick()

    expect(wrapper.find('[data-testid="forecast-fallback-badge-line"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="forecast-fallback-badge-bar"]').exists()).toBe(true)

    wrapper.unmount()
  })
})
