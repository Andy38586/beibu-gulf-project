// @vitest-environment jsdom
/**
 * SiteSuitabilityPage 防抖冒烟测试（单元五判据）：
 * 挂载页面（真实 Pinia + mock 事务/图层），改变权重后断言——
 * ①300ms 内不触发更新（防抖）；②300ms 后恰好触发一次。
 * 事务/图层 mock 化，只验证页面自身装配与防抖逻辑。
 */
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  updateLayer: vi.fn(),
  startTransaction: vi.fn(() => ({ transactionId: 1, signal: new AbortController().signal })),
  isTransactionValid: vi.fn(() => true),
  cancelAll: vi.fn(),
  runInTransaction: vi.fn((fn: () => unknown) => fn()),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  onBeforeRouteLeave: vi.fn(),
}))

vi.mock('@/business/site-suitability/composables/useSiteSuitabilityRequest', () => ({
  useSiteSuitabilityRequest: () => ({
    runInTransaction: h.runInTransaction,
    startTransaction: h.startTransaction,
    isTransactionValid: h.isTransactionValid,
    cancelAll: h.cancelAll,
  }),
}))

vi.mock('@/business/site-suitability/composables/useSiteSuitabilityLayer', () => ({
  useSiteSuitabilityLayer: () => ({
    updateLayer: h.updateLayer,
    renderer: { value: { getType: () => '2d' } },
  }),
}))

vi.mock(
  '@/shared/composables/useApiRequest',
  async (importOriginal: () => Promise<typeof import('@/shared/composables/useApiRequest')>) => {
    const actual = await importOriginal()
    return { ...actual, useApiRequest: () => ({ apiRequest: vi.fn() }) }
  }
)

import SiteSuitabilityPage from '../SiteSuitabilityPage.vue'
import { useSiteSuitabilityStore } from '@/stores/siteSuitabilityStore'

describe('SiteSuitabilityPage 防抖', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('权重变化后 300ms 内不更新、300ms 后恰一次（防抖判据）', async () => {
    const wrapper = shallowMount(SiteSuitabilityPage, { global: { plugins: [] } })
    await wrapper.vm.$nextTick()
    h.updateLayer.mockClear()
    const state = useSiteSuitabilityStore()
    state.setWeight('inundation', 0.6)
    state.setWeight('land', 0.3)
    await wrapper.vm.$nextTick()
    expect(h.updateLayer).not.toHaveBeenCalled() // 防抖窗口内零触发
    vi.advanceTimersByTime(299)
    expect(h.updateLayer).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(h.updateLayer).toHaveBeenCalledTimes(1) // 300ms 整恰一次
    wrapper.unmount()
  })

  it('连续变化只触发末次（300ms 内三次写状态 → 一次更新）', async () => {
    const wrapper = shallowMount(SiteSuitabilityPage, { global: { plugins: [] } })
    await wrapper.vm.$nextTick()
    h.updateLayer.mockClear()
    const state = useSiteSuitabilityStore()
    state.setWeight('inundation', 0.5)
    await wrapper.vm.$nextTick() // watch 回调是微任务：先 flush 再推时钟，定时器才会被调度
    vi.advanceTimersByTime(200)
    state.setWeight('inundation', 0.7)
    await wrapper.vm.$nextTick()
    vi.advanceTimersByTime(200)
    state.setWeight('inundation', 0.9)
    await wrapper.vm.$nextTick()
    vi.advanceTimersByTime(300)
    expect(h.updateLayer).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
