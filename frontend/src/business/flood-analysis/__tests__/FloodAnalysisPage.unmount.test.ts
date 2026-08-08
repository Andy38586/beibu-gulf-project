// @vitest-environment jsdom
/**
 * FloodAnalysisPage 卸载守卫回归测试（H-4 / P0-5 / R-4）
 * 背景（P0-5 修复）：页面卸载（onUnmounted）时：
 * 1. 中止在途请求（floodAbortController.abort / impactAbortController.abort），
 * 使迟到的响应无法再触达渲染器；
 * 2. 置 unmounted=true，triggerFloodAnalysis/triggerImpactAssessment 在拿到响应后
 * 经 `if (unmounted) return` 直接返回，绝不调用 manager.register → 页面离开后图层不复活。
 * 本测试锁定（审计编号：H-4 / P0-5 / R-4）：
 * - wrapper.unmount() 后，在途分析的 AbortSignal.aborted === true（在途请求被 abort）；
 * - 卸载后解析迟到响应，manager.register('flood-area') 调用次数与挂载时一致（迟到响应未重新注册）。
 * 仅 mock 外部依赖（useBusinessLayers 的 manager、floodAdapter、vue-router），不 mock 被测组件内部。
 */
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMapStore } from '@/stores'
import { useFloodStore } from '@/stores'

const h = vi.hoisted(() => {
  const mockManager = {
    register: vi.fn(),
    remove: vi.fn(),
    has: vi.fn(() => false),
    updateData: vi.fn(),
    reapplyAll: vi.fn(),
    removeAllFromRenderer: vi.fn(),
  }
  // a048: 每次 getFloodAnalysis 调用独立记录 signal 与 resolve（多次分析场景）
  const floodCalls: { signal: AbortSignal | null; resolve: (v: unknown) => void }[] = []
  const getWaterArea = vi.fn().mockResolvedValue([
    [108.5, 21.7],
    [108.6, 21.8],
  ])
  const getFloodAnalysis = vi.fn((_level: number, opts?: { signal?: AbortSignal }) => {
    return new Promise((resolve) => {
      floodCalls.push({ signal: opts?.signal ?? null, resolve })
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
    getFloodCalls: () => floodCalls,
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

    // a048 滑块联动：首屏 immediate watch 跳过自动分析（等待用户操作）。
    // 第一次操作滑块 → 分析①（正常在途）
    useFloodStore().setWaterLevel(8)
    await flushPromises()
    vi.advanceTimersByTime(600) // 推进防抖定时器
    await flushPromises()
    expect(h.getFloodCalls().length).toBe(1)

    // 分析① 正常响应 → renderFloodAreas 经 has() 兜底注册 'flood-area'（a048 联动）
    h.getFloodCalls()[0].resolve({
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
    const registerBefore = h.mockManager.register.mock.calls.filter(
      (c) => c[0] === 'flood-area'
    ).length
    expect(registerBefore).toBeGreaterThanOrEqual(1)

    // 第二次操作滑块 → 分析②（在途，本次要卸载）
    useFloodStore().setWaterLevel(9)
    await flushPromises()
    vi.advanceTimersByTime(600)
    await flushPromises()
    const signal = h.getFloodCalls()[1].signal
    expect(signal).toBeTruthy()

    // 卸载 → onUnmounted 应 abort 在途请求（分析②）
    wrapper.unmount()
    await flushPromises()
    expect(signal!.aborted).toBe(true)

    // 解析迟到响应（分析②）：因 unmounted=true，renderFloodAreas 不应再次 register
    h.getFloodCalls()[1].resolve({
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
