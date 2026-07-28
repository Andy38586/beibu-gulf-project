/**
 * Flood Data Adapter
 *
 * 职责：隔离浸没分析业务层与数据源。
 * 业务层（FloodAnalysisPage）通过此 Adapter 获取数据，
 * 无需关心数据来自 Mock 还是真实 API/数据库。
 */

// ==================== 数据源配置 ====================
let _dataSource: 'mock' | 'api' = 'mock'

const FALLBACK_WATER_AREA_COORDINATES: [number, number][] = [
  [108.615, 21.855],
  [108.62, 21.855],
  [108.622, 21.858],
  [108.621, 21.862],
  [108.618, 21.863],
  [108.614, 21.861],
  [108.615, 21.855],
]

// ==================== 内部 Mock 实现 ====================
let _cachedWaterAreaCoords: [number, number][] | null = null

async function _fetchMockWaterArea(): Promise<[number, number][]> {
  if (_cachedWaterAreaCoords) return _cachedWaterAreaCoords
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    const res = await fetch('/data/water-area.json', { signal: controller.signal })
    clearTimeout(timeoutId)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const coords: [number, number][] = data.coordinates
    _cachedWaterAreaCoords = coords
    return coords
  } catch {
    if (import.meta.env.DEV) {
      console.warn('[FloodAdapter] water-area.json 加载失败，使用兜底坐标')
    }
    return FALLBACK_WATER_AREA_COORDINATES
  }
}

async function _fetchMockJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) {
    throw new Error(`[FloodAdapter] 静态 fixture 加载失败: ${url} (HTTP ${res.status})`)
  }
  return (await res.json()) as T
}

interface FloodAnalysisResult {
  features: unknown[]
  statistics: unknown
  riskLevel: string
  actualWaterLevel?: number
}

interface ImpactAssessmentResult {
  affectedFacilities: unknown[]
  totalLoss: number
}

interface RequestOptions {
  signal?: AbortSignal
}

export const floodAdapter = {
  get dataSource(): string {
    return _dataSource
  },

  setDataSource(mode: 'mock' | 'api'): void {
    if (mode !== 'mock' && mode !== 'api') {
      throw new Error(`[FloodAdapter] 无效的数据源模式: ${mode}，仅支持 'mock' 或 'api'`)
    }
    _dataSource = mode
    if (import.meta.env.DEV) {
      console.info(`[FloodAdapter] 数据源切换为: ${mode}`)
    }
  },

  async getWaterArea(): Promise<[number, number][]> {
    if (_dataSource === 'mock') {
      return _fetchMockWaterArea()
    }
    throw new Error('[FloodAdapter] 真实 API 尚未接入，请先调用 setDataSource("mock")')
  },

  async getFloodAnalysis(
    _waterLevel: number,
    { signal }: RequestOptions = {}
  ): Promise<FloodAnalysisResult> {
    if (_dataSource === 'mock') {
      const [floodAreasRes, statisticsRes] = await Promise.all([
        _fetchMockJson<{ code: number; data: Record<string, unknown> }>('/data/flood-areas.json', signal),
        _fetchMockJson<{ code: number; data: Record<string, unknown> }>('/data/flood-statistics.json', signal),
      ])

      if (floodAreasRes.code !== 200 || statisticsRes.code !== 200) {
        throw new Error('[FloodAdapter] 淹没分析响应异常')
      }

      const floodData = floodAreasRes.data as Record<string, unknown> | undefined

      return {
        features: (floodData?.features as unknown[]) || [],
        statistics: statisticsRes.data,
        riskLevel: (floodData?.riskLevel as string) || '无风险',
        actualWaterLevel: floodData?.actualWaterLevel as number | undefined,
      }
    }
    throw new Error('[FloodAdapter] 真实 API 尚未接入，请先调用 setDataSource("mock")')
  },

  async getImpactAssessment(
    _waterLevel: number,
    { signal }: RequestOptions = {}
  ): Promise<ImpactAssessmentResult> {
    if (_dataSource === 'mock') {
      const res = await _fetchMockJson<{ code: number; data: Record<string, unknown> }>(
        '/data/disaster.json',
        signal
      )

      if (res.code !== 200) {
        throw new Error('[FloodAdapter] 影响评估响应异常')
      }

      const result = res.data as Record<string, unknown> | undefined
      return {
        affectedFacilities: (result?.affectedFacilities as unknown[]) || [],
        totalLoss: (result?.totalLoss as number) || 0,
      }
    }
    throw new Error('[FloodAdapter] 真实 API 尚未接入，请先调用 setDataSource("mock")')
  },

  async getDEM(_region: unknown): Promise<Record<string, string>> {
    if (_dataSource === 'mock') {
      return { source: 'mock', note: '后端已使用模拟 DEM 数据' }
    }
    throw new Error('[FloodAdapter] 真实 DEM 尚未接入，请先调用 setDataSource("mock")')
  },

  clearCache(): void {
    _cachedWaterAreaCoords = null
  },
}
