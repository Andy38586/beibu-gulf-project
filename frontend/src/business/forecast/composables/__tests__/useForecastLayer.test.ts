import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, ErrorCode } from '@/shared'
import { useForecastStore } from '@/stores/forecastStore'
import { useMapStore } from '@/stores/mapStore'

// vi.mock 工厂被 hoist 到文件顶部，工厂内不能引用顶层 const——
// 用 vi.hoisted 定义 mock 函数（2026-08-08：修复 Cannot access before initialization）
const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }))

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

// mock useApiRequest（2026-08-08：forecastAdapter 已删，useForecastLayer 直连统一入口，
// 请求由 mockApiRequest 控制；mockApiRequest 由 vi.hoisted 提供，见文件顶部）

// mock @/shared 的副作用函数 + useApiRequest
vi.mock('@/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared')>()
  return {
    ...actual,
    useApiRequest: () => ({ apiRequest: mockApiRequest }),
    handleAuthError: vi.fn(),
    showError: vi.fn(),
  }
})

import { handleAuthError, showError } from '@/shared'

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

  it('成功路径: apiRequest 返回 geojson 后 updateData 到对应图层 key', async () => {
    const mapStore = useMapStore()
    mapStore.currentRenderer = fakeRenderer as never
    const forecastStore = useForecastStore()
    forecastStore.activeIndicator = 'cargo'

    mockApiRequest.mockResolvedValue({
      features: [{ id: 1 }],
    })

    const { startTransaction } = useForecastRequest()
    const { updateForecastLayer } = useForecastLayer()
    const t = startTransaction()

    await updateForecastLayer(t.transactionId, t.signal)

    expect(mockApiRequest).toHaveBeenCalledWith(
      '/forecast/map',
      expect.objectContaining({
        params: expect.objectContaining({ indicator: 'cargo' }),
        signal: expect.any(AbortSignal),
      })
    )
    expect(mockManager.updateData).toHaveBeenCalledWith(
      'forecast-cargo',
      expect.objectContaining({ data: [{ id: 1 }] })
    )
  })

  it('apiRequest 返回 null（事务取消）时跳过 updateData', async () => {
    const mapStore = useMapStore()
    mapStore.currentRenderer = fakeRenderer as never

    mockApiRequest.mockResolvedValue(null)

    const { startTransaction } = useForecastRequest()
    const { updateForecastLayer } = useForecastLayer()
    const t = startTransaction()

    await updateForecastLayer(t.transactionId, t.signal)

    expect(mockManager.updateData).not.toHaveBeenCalled()
  })

  it('401 时走 handleAuthError 且不抛错', async () => {
    const mapStore = useMapStore()
    mapStore.currentRenderer = fakeRenderer as never

    mockApiRequest.mockRejectedValue(
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
