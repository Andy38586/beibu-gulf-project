import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { SLOW_REQUEST_THRESHOLD_MS } from '@/shared/composables/useSlowRequestOffer'
import { closeModal, confirmModal, gcsModalState } from '@/shared/utils/gcsFeedback'
import { useMapStore } from '@/stores/mapStore'
import { useSiteSuitabilityStore } from '@/stores/siteSuitabilityStore'
import { useTaskStore } from '@/stores/taskStore'

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
      void updateLayer(transactionId, signal)
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
      void layer.updateLayer(transactionId, signal)
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

  // 方案 A 的**接线断言**：只有纯函数用例、没有接线断言 = 未完成（协议 7.1）。
  // 这里证明「慢 → 提示 → 一键 → 真的用同一份参数提交了 task 域」这条链是通着的。
  it('🔴 接线：慢请求超阈值 → 弹提示 → 一键转后台 = 同一份参数提交 site-suitability-map', async () => {
    useMapStore().currentRenderer = fakeRenderer as never
    vi.useFakeTimers()
    try {
      // 在途请求永不返回 ⇒ 计时器必然到期
      mockApiRequest.mockImplementation(() => new Promise(() => undefined))
      const taskStore = useTaskStore()
      const submitSpy = vi.spyOn(taskStore, 'submit').mockResolvedValue('task-1')
      vi.spyOn(taskStore, 'waitForResult').mockResolvedValue(null)
      const setDockedSpy = vi.spyOn(taskStore, 'setDocked')

      const scope = effectScope()
      scope.run(() => {
        const { updateLayer } = useSiteSuitabilityLayer()
        const { startTransaction } = useSiteSuitabilityRequest()
        const { transactionId, signal } = startTransaction()
        void updateLayer(transactionId, signal)
      })

      await vi.advanceTimersByTimeAsync(SLOW_REQUEST_THRESHOLD_MS - 200)
      expect(gcsModalState.visible).toBe(false) // 未到阈值不打扰

      await vi.advanceTimersByTimeAsync(400)
      expect(gcsModalState.visible).toBe(true)

      confirmModal()
      await vi.advanceTimersByTimeAsync(0)

      expect(submitSpy).toHaveBeenCalledTimes(1)
      const arg = submitSpy.mock.calls[0][0] as {
        route: string
        domain: string
        params: Record<string, unknown>
      }
      expect(arg.route).toBe('/site-suitability')
      expect(arg.domain).toBe('site-suitability-map')
      // 与直连请求同一份参数（同一构造函数 ⇒ 不漂移）
      expect(arg.params.resolution).toBe(0.02)
      expect(arg.params.min_land_frac).toBe(0.5)
      expect(arg.params.w_inundation).toBe(0.4)
      expect(setDockedSpy).toHaveBeenCalledWith('/site-suitability', true)
    } finally {
      closeModal()
      vi.useRealTimers()
    }
  })
})
