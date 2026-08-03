import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, ErrorCode } from '@/shared'
import { useForecastStore } from '@/stores/forecastStore'
import { useMapStore } from '@/stores/mapStore'

// mock vue-router
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// mock @/core 的 useBusinessLayers（manager 由测试注入）
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
  }
})

// mock forecastAdapter（getMapData 由测试控制）
vi.mock('@/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services')>()
  return {
    ...actual,
    forecastAdapter: {
      ...actual.forecastAdapter,
      getMapData: vi.fn(),
    },
  }
})

// mock @/shared 的副作用函数
vi.mock('@/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared')>()
  return {
    ...actual,
    handleAuthError: vi.fn(),
    showError: vi.fn(),
  }
})

import { handleAuthError, showError } from '@/shared'
import { forecastAdapter } from '@/services'

import { useForecastLayer } from '../useForecastLayer'
import { useForecastRequest } from '../useForecastRequest'

const fakeRenderer = { getType: () => '2d' }

describe('useForecastLayer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const mapStore = useMapStore()
    mapStore.currentRenderer = null
    // 重置 manager mock 默认值
    mockManager.has.mockImplementation(() => false)
  })

  it('渲染器不存在时 updateForecastLayer 直接返回', async () => {
    const { updateForecastLayer } = useForecastLayer()
    await expect(updateForecastLayer(1, new AbortController().signal)).resolves.toBeUndefined()
    expect(mockManager.updateData).not.toHaveBeenCalled()
  })

  it('成功路径: adapter 返回 geojson 后 updateData 到对应图层 key', async () => {
    const mapStore = useMapStore()
    mapStore.currentRenderer = fakeRenderer as never
    const forecastStore = useForecastStore()
    forecastStore.activeIndicator = 'cargo'

    ;(forecastAdapter.getMapData as ReturnType<typeof vi.fn>).mockResolvedValue({
      features: [{ id: 1 }],
    })

    const { startTransaction } = useForecastRequest()
    const { updateForecastLayer } = useForecastLayer()
    const t = startTransaction()

    await updateForecastLayer(t.transactionId, t.signal)

    expect(forecastAdapter.getMapData).toHaveBeenCalledWith(
      'cargo',
      expect.any(String),
      expect.any(Number),
      expect.any(AbortSignal)
    )
    expect(mockManager.updateData).toHaveBeenCalledWith(
      'forecast-cargo',
      expect.objectContaining({ data: [{ id: 1 }] })
    )
  })

  it('adapter 返回 null（事务取消）时跳过 updateData', async () => {
    const mapStore = useMapStore()
    mapStore.currentRenderer = fakeRenderer as never

    ;(forecastAdapter.getMapData as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const { startTransaction } = useForecastRequest()
    const { updateForecastLayer } = useForecastLayer()
    const t = startTransaction()

    await updateForecastLayer(t.transactionId, t.signal)

    expect(mockManager.updateData).not.toHaveBeenCalled()
  })

  it('401 时走 handleAuthError 且不抛错', async () => {
    const mapStore = useMapStore()
    mapStore.currentRenderer = fakeRenderer as never

    ;(forecastAdapter.getMapData as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError('请先登录', ErrorCode.UNAUTHORIZED)
    )

    const { startTransaction } = useForecastRequest()
    const { updateForecastLayer } = useForecastLayer()
    const t = startTransaction()

    await expect(updateForecastLayer(t.transactionId, t.signal)).resolves.toBeUndefined()
    expect(handleAuthError).toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
  })

  it('removeForecastLayer 移除全部 4 个指标图层', () => {
    const { removeForecastLayer } = useForecastLayer()
    mockManager.has.mockImplementation(() => true)
    removeForecastLayer()
    expect(mockManager.remove).toHaveBeenCalledTimes(4)
    const keys = (mockManager.remove as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0]
    )
    expect(keys).toEqual(['forecast-cargo', 'forecast-container', 'forecast-berth', 'forecast-traffic'])
  })
})
