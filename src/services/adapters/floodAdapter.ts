/**
 * Flood Data Adapter
 *
 * 职责：隔离浸没分析业务层与数据源。
 * 业务层（FloodAnalysisPage）通过此 Adapter 获取数据，
 * 无需关心数据来自 Mock 还是真实 API/数据库。
 */

import { useApiRequest } from '@/shared/composables/useApiRequest'

const { apiRequest } = useApiRequest()

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
    waterLevel: number,
    { signal }: RequestOptions = {}
  ): Promise<FloodAnalysisResult> {
    if (_dataSource === 'mock') {
      const [floodAreasData, statisticsData] = await Promise.all([
        apiRequest<Record<string, unknown>>(`/gcs/flood-areas?waterLevel=${waterLevel}`, {
          signal,
        }),
        apiRequest<Record<string, unknown>>(`/gcs/flood-statistics?waterLevel=${waterLevel}`, {
          signal,
        }),
      ])

      if (floodAreasData.code !== 200 || statisticsData.code !== 200) {
        throw new Error('[FloodAdapter] 淹没分析响应异常')
      }

      const floodData = floodAreasData.data as Record<string, unknown> | undefined

      return {
        features: (floodData?.features as unknown[]) || [],
        statistics: statisticsData.data,
        riskLevel: (floodData?.riskLevel as string) || '无风险',
        actualWaterLevel: floodData?.actualWaterLevel as number | undefined,
      }
    }
    throw new Error('[FloodAdapter] 真实 API 尚未接入，请先调用 setDataSource("mock")')
  },

  async getImpactAssessment(
    waterLevel: number,
    { signal }: RequestOptions = {}
  ): Promise<ImpactAssessmentResult> {
    if (_dataSource === 'mock') {
      const data = await apiRequest<Record<string, unknown>>('/gcs/analysis/disaster', {
        method: 'POST',
        body: JSON.stringify({ waterLevel }),
        signal,
      })

      if (data.code !== 200) {
        throw new Error('[FloodAdapter] 影响评估响应异常')
      }

      const result = data.data as Record<string, unknown> | undefined
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
