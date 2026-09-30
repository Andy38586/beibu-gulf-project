import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useSiteSuitabilityStore } from '@/stores/siteSuitabilityStore'
import { useMapStore } from '@/stores/mapStore'

// vi.mock 工厂 hoist——mock 函数用 vi.hoisted（对齐 useForecastLayer.test.ts 体例）
const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const mockManager = {
  has: vi.fn(() => false),
  register: vi.fn(),
  updateData: vi.fn(),
  setVisible: vi.fn(),
  remove: vi.fn(),
}
vi.mock('@/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core')>()
  return {
    ...actual,
    useBusinessLayers: () => ({ manager: mockManager }),
    useOwnedLayers: () => ({
      register: vi.fn(),
    }),
  }
})

vi.mock('@/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared')>()
  return {
    ...actual,
    useApiRequest: () => ({ apiRequest: mockApiRequest }),
    handleAuthError: vi.fn(),
    showError: vi.fn(),
  }
})

import { useSiteSuitabilityLayer } from '../useSiteSuitabilityLayer'
import { useSiteSuitabilityRequest } from '../useSiteSuitabilityRequest'

const fakeRenderer = { getType: () => '2d' }

describe('useSiteSuitabilityLayer（BLM 注册/更新 + 事务取消）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useMapStore().currentRenderer = null
  })

  it('更新走 BLM.updateData，参数携带权重与 min_land_frac', async () => {
    useMapStore().currentRenderer = fakeRenderer as never
    mockApiRequest.mockResolvedValue({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [108.6, 21.9] },
          properties: { id: 1, score: 0.5 },
        },
      ],
      metadata: {
        count: 1,
        weights: { inundation: 0.4, terrain: 0.1, land: 0.2, access: 0.2, demand: 0.1 },
        weightsSource: 'ahp-final',
        kdeP99: 0,
        minLandFrac: 0.5,
      },
    })
    const scope = effectScope()
    scope.run(() => {
      const { updateLayer } = useSiteSuitabilityLayer()
      const { startTransaction } = useSiteSuitabilityRequest()
      const { transactionId, signal } = startTransaction()
      return updateLayer(transactionId, signal)
    })
    await scope.run(async () => undefined)
    await vi.waitFor(() => expect(mockApiRequest).toHaveBeenCalled())
    const call = mockApiRequest.mock.calls[0]
    expect(call[0]).toBe('/site-suitability/map')
    expect(call[1].params.w_inundation).toBe(0.4)
    expect(call[1].params.min_land_frac).toBe(0.5)
    await vi.waitFor(() => expect(mockManager.updateData).toHaveBeenCalled())
    expect(mockManager.updateData.mock.calls[0][0]).toBe('site-suitability-main')
  })

  it('旧事务响应被丢弃（竞态守卫）：事务过期后 resolve 不写图、不缓存', async () => {
    useMapStore().currentRenderer = fakeRenderer as never
    let resolveLater: (v: unknown) => void = () => undefined
    mockApiRequest.mockImplementation(() => new Promise((resolve) => (resolveLater = resolve)))
    const state = useSiteSuitabilityStore()
    const scope = effectScope()
    let captured: { updateLayer: (t: number, s: AbortSignal) => Promise<void> } | null = null
    scope.run(() => {
      const layer = useSiteSuitabilityLayer()
      captured = layer as never
      const { startTransaction } = useSiteSuitabilityRequest()
      const { transactionId, signal } = startTransaction()
      // 事务 A 发出后，立刻推进事务 ID 模拟新事务（A 过期）
      state.bumpTransactionId()
      return layer.updateLayer(transactionId, signal)
    })
    resolveLater({
      type: 'FeatureCollection',
      features: [],
      metadata: { count: 0, weights: {}, weightsSource: 'ahp-final', kdeP99: 0, minLandFrac: 0.5 },
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(mockManager.updateData).not.toHaveBeenCalled()
    expect(captured).not.toBeNull()
  })
})
