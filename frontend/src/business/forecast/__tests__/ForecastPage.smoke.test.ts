// @vitest-environment jsdom
/**
 * ForecastPage 挂载冒烟测试（2026-08-11：页面级 0 覆盖补充）
 * 目标：页面在真实 Pinia + mock 外部依赖下可挂载/卸载不抛错，
 * 关键子组件渲染到位（shallowMount stub 子组件，只验证页面自身装配逻辑）。
 */
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  runInTransaction: vi.fn((fn: () => unknown) => fn()),
  startTransaction: vi.fn(() => 1),
  isTransactionValid: vi.fn(() => true),
  cancelAll: vi.fn(),
  updateForecastLayer: vi.fn(),
  removeForecastLayer: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
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
    removeForecastLayer: h.removeForecastLayer,
    renderer: { value: null },
  }),
}))

// mock useApiRequest 子模块（入口 @/shared 的 re-export 会解析到 mock）
vi.mock('@/shared/composables/useApiRequest', () => ({
  useApiRequest: () => ({ apiRequest: h.apiRequest }),
}))

import ForecastPage from '../ForecastPage.vue'

describe('ForecastPage 冒烟', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    h.apiRequest.mockResolvedValue({
      code: 200,
      data: { timeseries: [], series: [], indicators: [] },
    })
  })

  it('挂载渲染成功且不抛错（onMounted 仅消费快照/重置）', async () => {
    const wrapper = shallowMount(ForecastPage)
    expect(wrapper.exists()).toBe(true)
    // 页面根容器渲染
    expect(wrapper.find('.forecast-page').exists()).toBe(true)
    wrapper.unmount()
  })
})
