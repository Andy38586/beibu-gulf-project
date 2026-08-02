// @vitest-environment jsdom
/**
 * FloodAnalysisPage 卸载守卫回归测试（H-4 / P0-5 / R-4）
 *
 * 背景（P0-5 修复）：页面卸载（onUnmounted）时：
 *   1. 中止在途请求（floodAbortController.abort / impactAbortController.abort），
 *      使迟到的响应无法再触达渲染器；
 *   2. 置 unmounted=true，triggerFloodAnalysis/triggerImpactAssessment 在拿到响应后
 *      经 `if (unmounted) return` 直接返回，绝不调用 manager.register → 页面离开后图层不复活。
 *
 * 本测试锁定（审计编号：H-4 / P0-5 / R-4）：
 *   - wrapper.unmount() 后，在途分析的 AbortSignal.aborted === true（在途请求被 abort）；
 *   - 卸载后解析迟到响应，manager.register('flood-area') 调用次数与挂载时一致（迟到响应未重新注册）。
 *
 * 仅 mock 外部依赖（useBusinessLayers 的 manager、floodAdapter、vue-router），不 mock 被测组件内部。
 */
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMapStore } from '@/stores/mapStore'

const h = vi.hoisted(() => {
  const mockManager = {
    register: vi.fn(),
    remove: vi.fn(),
    has: vi.fn(() => false),
    updateData: vi.fn(),
    reapplyAll: vi.fn(),
    removeAllFromRenderer: vi.fn(),
  }
  let floodResolve: ((v: unknown) => void) | null = null
  let floodSignal: AbortSignal | null = null
  const getWaterArea = vi.fn().mockResolvedValue([
    [108.5, 21.7],
    [108.6, 21.8],
  ])
  const getFloodAnalysis = vi.fn((_level: number, opts?: { signal?: AbortSignal }) => {
    floodSignal = opts?.signal ?? null
    return new Promise((resolve) => {
      floodResolve = resolve
    })
  })
  // 影响评估请求保持 pending，避免其分支调用 manager（聚焦洪涝分析 abort 路径）
  const getImpactAssessment = vi.fn(() => new Promise(() => {}))
  const clearCache = vi.fn()
  const setDataSource = vi.fn()
  return {
    mockManager,
    getWaterArea,
    getFloodAnalysis,
    getImpactAssessment,
    clearCache,
    setDataSource,
    getFloodResolve: () => floodResolve,
    getFloodSignal: () => floodSignal,
  }
})

vi.mock('@/core/map/composables/useBusinessLayers', () => ({
  useBusinessLayers: vi.fn(() => ({ manager: h.mockManager })),
}))

vi.mock('@/services/adapters/floodAdapter', () => ({
  floodAdapter: {
    getWaterArea: h.getWaterArea,
    getFloodAnalysis: h.getFloodAnalysis,
    getImpactAssessment: h.getImpactAssessment,
    clearCache: h.clearCache,
    setDataSource: h.setDataSource,
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { engine: 'ol' }, params: {}, query: {} }),
  onBeforeRouteLeave: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}))

import FloodAnalysisPage from '../FloodAnalysisPage.vue'

describe('FloodAnalysisPage 卸载守卫（H-4 / P0-5 / R-4）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    h.mockManager.has.mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('卸载后迟到响应不重新注册图层，且在途请求被 abort', async () => {
    vi.useFakeTimers()
    const wrapper = shallowMount(FloodAnalysisPage)

    // 设置 renderer：使 shouldRenderForCurrentRoute() 为 true，并触发 registerFloodLayers
    const mapStore = useMapStore()
    mapStore.currentRenderer = { getType: () => 'ol' } as never
    await flushPromises()
    // 推进防抖定时器（ANALYSIS_DELAY=500ms），触发一次洪涝分析（在途）
    vi.advanceTimersByTime(600)
    await flushPromises()

    const signal = h.getFloodSignal()
    expect(signal).toBeTruthy()

    // 挂载时 registerFloodLayers 已注册 'flood-area'
    const registerBefore = h.mockManager.register.mock.calls.filter(
      (c) => c[0] === 'flood-area'
    ).length
    expect(registerBefore).toBeGreaterThanOrEqual(1)

    // 卸载 → onUnmounted 应 abort 在途请求
    wrapper.unmount()
    await flushPromises()
    expect(signal!.aborted).toBe(true)

    // 解析迟到响应：因 unmounted=true，renderFloodAreas 不应再次 register
    const resolve = h.getFloodResolve()
    expect(resolve).toBeTypeOf('function')
    resolve!({
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [108.5, 21.7] },
          properties: {},
        },
      ],
      statistics: {},
      riskLevel: '中',
    })
    await flushPromises()

    const registerAfter = h.mockManager.register.mock.calls.filter(
      (c) => c[0] === 'flood-area'
    ).length
    expect(registerAfter).toBe(registerBefore)

    vi.useRealTimers()
  })
})
