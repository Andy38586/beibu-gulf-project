/**
 * Flood Data Adapter
 *
 * 职责：隔离浸没分析业务层与数据源。
 * 业务层（FloodAnalysisPage）通过此 Adapter 获取数据，
 * 无需关心数据来自 Mock 还是真实 API/数据库。
 */

import { useApiRequest } from '@/shared'
import { loadStatic } from '@/shared'
import { logger } from '@/shared'
import type { AffectedFacility, FloodFeature, FloodStatistics } from '@/types/business/base'
import { floodOnlineResponseSchema } from '@/types/schemas'

import { resolveDataSource, setAdapterDataSource } from '../dataSourceConfig'

// ==================== 数据源配置（委托给统一 dataSourceConfig） ====================

const { apiRequest } = useApiRequest()

const ADAPTER_NAME = 'flood'

const FALLBACK_WATER_AREA_COORDINATES: [number, number][] = [
  [108.615, 21.855],
  [108.62, 21.855],
  [108.622, 21.858],
  [108.621, 21.862],
  [108.618, 21.863],
  [108.614, 21.861],
  [108.615, 21.855],
]

// ==================== 内部 Mock 实现（统一使用 loadStatic） ====================
let _cachedWaterAreaCoords: [number, number][] | null = null

async function _fetchMockWaterArea(): Promise<[number, number][]> {
  if (_cachedWaterAreaCoords) return _cachedWaterAreaCoords
  try {
    const data = await loadStatic<{ coordinates?: [number, number][] }>('/data/water-area.json')
    if (!Array.isArray(data?.coordinates) || data.coordinates.length === 0) {
      throw new Error('water-area.json 缺少 coordinates 数组')
    }
    const coords: [number, number][] = data.coordinates
    _cachedWaterAreaCoords = coords
    return coords
  } catch {
    logger.debug('[FloodAdapter] water-area.json 加载失败，使用兆底坐标')
    return FALLBACK_WATER_AREA_COORDINATES
  }
}

/**
 * 加载 Mock JSON（统一使用 loadStatic，超时 10s + 去重）
 */
async function _fetchMockJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return loadStatic<T>(url, { signal, cacheTTL: 0 })
}

interface FloodAnalysisResult {
  features: FloodFeature[]
  statistics: FloodStatistics
  riskLevel: string
  actualWaterLevel?: number
}

interface ImpactAssessmentResult {
  affectedFacilities: AffectedFacility[]
  totalLoss: number
}

interface RequestOptions {
  signal?: AbortSignal
}

// ==================== Mock 字段映射（N4: adapter 层做映射，不改类型定义） ====================
// Mock 数据字段名与 types/business/base.ts 的类型定义存在差异：
// - FloodFeature.properties 缺 riskLevel（需从顶层 riskLevel 补入）
// - FloodStatistics: floodArea → totalArea, affectedFacilities → affectedCount
// - AffectedFacility: longitude → lng, latitude → lat, 缺 id/loss/damageRate（从 impact 派生）

/** 影响等级 → 损坏率映射 */
const IMPACT_DAMAGE_RATE: Record<string, number> = {
  重度: 0.8,
  中度: 0.5,
  轻度: 0.2,
}

/** 将 mock flood-areas.json 的 features 映射为 FloodFeature[] */
function _mapFloodFeatures(rawFeatures: unknown, fallbackRiskLevel: string): FloodFeature[] {
  if (!Array.isArray(rawFeatures)) return []
  return rawFeatures.map((f) => {
    const props = (f.properties ?? {}) as Record<string, unknown>
    return {
      type: 'Feature' as const,
      geometry: f.geometry,
      properties: {
        ...props,
        riskLevel: (props.riskLevel as string) ?? fallbackRiskLevel,
      },
    } as FloodFeature
  })
}

/** 将 mock/api flood-statistics 响应映射为 FloodStatistics
 * b033: 显式字段映射，不再 spread raw + as 断言 */
function _mapFloodStatistics(
  raw: Record<string, unknown> | undefined,
  fallbackRiskLevel: string
): FloodStatistics {
  const r = raw ?? {}
  return {
    riskLevel: (r.riskLevel as string) ?? fallbackRiskLevel,
    waterLevel: r.waterLevel as number | undefined,
    floodArea: r.floodArea as number | undefined,
    averageDepth: r.averageDepth as number | undefined,
    maxDepth: r.maxDepth as number | undefined,
    affectedFacilities: r.affectedFacilities as number | undefined,
    affectedPorts: r.affectedPorts as string[] | undefined,
    estimatedLoss: r.estimatedLoss as number | undefined,
    description: r.description as string | undefined,
  }
}

/** 将 mock disaster.json 的 affectedFacilities 映射为 AffectedFacility[] */
function _mapAffectedFacilities(rawFacilities: unknown, totalLoss: number): AffectedFacility[] {
  if (!Array.isArray(rawFacilities)) return []
  const totalDamageRate = rawFacilities.reduce((sum, f) => {
    const impact = (f as Record<string, unknown>).impact as string
    return sum + (IMPACT_DAMAGE_RATE[impact] ?? 0.1)
  }, 0)
  return rawFacilities.map((f, index) => {
    const raw = f as Record<string, unknown>
    const impact = raw.impact as string
    const damageRate = IMPACT_DAMAGE_RATE[impact] ?? 0.1
    return {
      id: String(raw.id ?? raw.name ?? index),
      name: (raw.name as string) ?? '',
      type: (raw.type as string) ?? '',
      lng: (raw.lng as number) ?? (raw.longitude as number) ?? 0,
      lat: (raw.lat as number) ?? (raw.latitude as number) ?? 0,
      port: raw.port as string | undefined,
      loss:
        totalDamageRate > 0
          ? Math.round(totalLoss * (damageRate / totalDamageRate) * 100) / 100
          : 0,
      damageRate,
    }
  })
}

/**
 * online 模式：在线演算风险等级（按淹没面积 + 水位双因子，配合实测数据阈值）
 * 实测参考：0.5m≈652km² 低、2.0m≈2593km² 中、3.5m≈4539km² 中、8.0m≈10943km² 高
 */
function _riskLevelFromFlood(floodedKm2: number, level: number): string {
  if (floodedKm2 <= 0) return '无风险'
  if (floodedKm2 >= 6000 || level >= 6) return '高风险'
  if (floodedKm2 >= 2000 || level >= 3) return '中风险'
  return '低风险'
}

/** online 模式：调用 FastAPI 在线演算服务（vite proxy /flood-online → localhost:8000）
 * z045: 用 floodOnlineResponseSchema.safeParse 替代裸 `res.json() as {...}` 隐式断言 */
async function _fetchOnlineFlood(
  waterLevel: number,
  signal?: AbortSignal
): Promise<{
  level: number
  featureCount: number
  floodedKm2: number
  features: FloodFeature[]
}> {
  const res = await fetch(`/flood-online/api/flood/online?level=${waterLevel}`, { signal })
  if (!res.ok) {
    throw new Error(`[FloodAdapter] 在线演算服务异常: HTTP ${res.status}`)
  }
  const raw = await res.json()
  const result = floodOnlineResponseSchema.safeParse(raw)
  if (!result.success) {
    logger.warn('[FloodAdapter] 在线演算响应数据校验失败:', result.error.issues)
    throw new Error('[FloodAdapter] 在线演算响应数据格式校验失败')
  }
  // features 元素类型由下游 map+as FloodFeature[] 收窄（与原裸 `res.json()` 一致的元素处理）
  return result.data as {
    level: number
    featureCount: number
    floodedKm2: number
    features: FloodFeature[]
  }
}

export const floodAdapter = {
  get dataSource(): string {
    return resolveDataSource(ADAPTER_NAME)
  },

  setDataSource(mode: 'mock' | 'api'): void {
    setAdapterDataSource(ADAPTER_NAME, mode)
  },

  async getWaterArea(): Promise<[number, number][]> {
    if (resolveDataSource(ADAPTER_NAME) === 'mock') {
      return _fetchMockWaterArea()
    }
    // api 模式：从后端只读端点获取水域坐标（D-4=A：后端 /flood/water-area 端点，
    // 数据与前端 water-area.json 同源，前后端共用同一份静态坐标）。
    const coords = await apiRequest<[number, number][]>('/flood/water-area')
    return coords
  },

  async getFloodAnalysis(
    waterLevel: number,
    { signal }: RequestOptions = {}
  ): Promise<FloodAnalysisResult> {
    // online 模式：FastAPI 实时演算（连通性淹没），业务层零改动（N4 adapter 隔离）
    if (resolveDataSource(ADAPTER_NAME) === 'online') {
      const data = await _fetchOnlineFlood(waterLevel, signal)
      const riskLevel = _riskLevelFromFlood(data.floodedKm2 ?? 0, data.level ?? waterLevel)
      const features = (data.features ?? []).map((f) => ({
        ...f,
        properties: { ...f.properties, riskLevel },
      })) as FloodFeature[]
      return {
        features,
        statistics: {
          totalArea: Math.round((data.floodedKm2 ?? 0) * 1e6), // km² → m²
          riskLevel,
          affectedCount: 0,
        },
        riskLevel,
        actualWaterLevel: data.level,
      }
    }
    if (resolveDataSource(ADAPTER_NAME) === 'mock') {
      // b019: mock 数据为静态单档位，不响应水位参数
      logger.warn(
        `[FloodAdapter] mock 模式不响应水位参数（请求 ${waterLevel}m，固定返回 2.5m 档位）`
      )
      const [floodAreasRes, statisticsRes] = await Promise.all([
        _fetchMockJson<{ code: number; data: Record<string, unknown> }>(
          '/data/flood-areas.json',
          signal
        ),
        _fetchMockJson<{ code: number; data: Record<string, unknown> }>(
          '/data/flood-statistics.json',
          signal
        ),
      ])

      if (floodAreasRes.code !== 200 || statisticsRes.code !== 200) {
        throw new Error('[FloodAdapter] 淹没分析响应异常')
      }

      const floodData = floodAreasRes.data as Record<string, unknown> | undefined
      const riskLevel = (floodData?.riskLevel as string) || '无风险'

      return {
        features: _mapFloodFeatures(floodData?.features, riskLevel),
        statistics: _mapFloodStatistics(statisticsRes.data as Record<string, unknown>, riskLevel),
        riskLevel,
        actualWaterLevel: floodData?.actualWaterLevel as number | undefined,
      }
    }
    // api 模式：调用后端 /flood/flood-areas + /flood/flood-statistics
    const [floodAreasRes, statisticsRes] = await Promise.all([
      apiRequest<Record<string, unknown>>('/flood/flood-areas', {
        params: { waterLevel },
        signal,
      }),
      apiRequest<Record<string, unknown>>('/flood/flood-statistics', {
        params: { waterLevel },
        signal,
      }),
    ])

    const floodData = floodAreasRes as Record<string, unknown> | undefined
    const riskLevel = (floodData?.riskLevel as string) || '无风险'
    const actualWaterLevel = floodData?.actualWaterLevel as number | undefined

    return {
      features: _mapFloodFeatures(floodData?.features, riskLevel),
      statistics: _mapFloodStatistics(statisticsRes as Record<string, unknown>, riskLevel),
      riskLevel,
      actualWaterLevel,
    }
  },

  async getImpactAssessment(
    waterLevel: number,
    { signal }: RequestOptions = {}
  ): Promise<ImpactAssessmentResult> {
    // online 模式：实时演算仅出淹没面，设施影响评估暂不提供（MVP，后续可接 DEM+设施叠加）
    if (resolveDataSource(ADAPTER_NAME) === 'online') {
      logger.debug(`[FloodAdapter] online 模式不评估设施影响（水位 ${waterLevel}m），返回空`)
      return { affectedFacilities: [], totalLoss: 0 }
    }
    if (resolveDataSource(ADAPTER_NAME) === 'mock') {
      logger.warn(`[FloodAdapter] mock 影响评估不响应水位参数（请求 ${waterLevel}m）`)
      const res = await _fetchMockJson<{ code: number; data: Record<string, unknown> }>(
        '/data/disaster.json',
        signal
      )

      if (res.code !== 200) {
        throw new Error('[FloodAdapter] 影响评估响应异常')
      }

      const result = res.data as Record<string, unknown> | undefined
      const totalLoss = (result?.totalLoss as number) || 0
      return {
        affectedFacilities: _mapAffectedFacilities(result?.affectedFacilities, totalLoss),
        totalLoss,
      }
    }
    // api 模式：调用后端 /flood/analysis/disaster
    const res = await apiRequest<Record<string, unknown>>('/flood/analysis/disaster', {
      method: 'POST',
      body: JSON.stringify({ waterLevel }),
      signal,
    })

    const result = res as Record<string, unknown> | undefined
    const totalLoss = (result?.totalLoss as number) || 0
    return {
      affectedFacilities: _mapAffectedFacilities(result?.affectedFacilities, totalLoss),
      totalLoss,
    }
  },

  async getDEM(_region: unknown): Promise<Record<string, string>> {
    // DEM 高程数据当前由 dem-hillshade 图层（静态 COG dem_hillshade.tif）直接消费，
    // 本方法为预留接口，暂无运行期调用方（b029 / D-3=A 核实）。
    // 三维水面为预设水位档位可视化（非真实高程演算），真地形见 D-10 决策。
    return {
      source: 'dem-pipeline',
      note: 'DEM 由 dem-hillshade 图层消费，getDEM 为预留钩子（无调用方）',
    }
  },

  clearCache(): void {
    _cachedWaterAreaCoords = null
  },
}
