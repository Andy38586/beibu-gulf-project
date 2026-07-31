/**
 * Flood Data Adapter
 *
 * 职责：隔离浸没分析业务层与数据源。
 * 业务层（FloodAnalysisPage）通过此 Adapter 获取数据，
 * 无需关心数据来自 Mock 还是真实 API/数据库。
 */

import { useApiRequest } from '@/shared/composables/useApiRequest'
import { logger } from '@/shared/utils/logger'
import type { AffectedFacility, FloodFeature, FloodStatistics } from '@/types/business/base'

// ==================== 数据源配置 ====================
let _dataSource: 'mock' | 'api' = 'mock'

const { apiRequest } = useApiRequest()

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
const FETCH_TIMEOUT_MS = 10000
let _cachedWaterAreaCoords: [number, number][] | null = null

async function _fetchMockWaterArea(): Promise<[number, number][]> {
  if (_cachedWaterAreaCoords) return _cachedWaterAreaCoords
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch('/data/water-area.json', { signal: controller.signal })
    clearTimeout(timeoutId)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    // 校验 coordinates 字段存在且为非空数组，防止 undefined 被缓存
    if (!Array.isArray(data?.coordinates) || data.coordinates.length === 0) {
      throw new Error('water-area.json 缺少 coordinates 数组')
    }
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

/**
 * 加载 Mock JSON 并断言为指定类型
 *
 * 注意：此处使用 `as T` 类型断言，无运行时 schema 校验。
 * Mock 数据由项目维护（public/data/*.json），结构可控。
 * 若未来接入真实 API，建议引入 zod/valibot 做运行时校验（见决策项 D-4）。
 *
 * 超时保护：10s，与 _fetchMockWaterArea 一致，防止 mock 文件加载慢时挂死。
 */
async function _fetchMockJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  // 合并外部 signal（若存在）
  const combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
  try {
    const res = await fetch(url, { signal: combinedSignal })
    if (!res.ok) {
      throw new Error(`[FloodAdapter] 静态 fixture 加载失败: ${url} (HTTP ${res.status})`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timeoutId)
  }
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

/** 将 mock flood-statistics.json 的 data 映射为 FloodStatistics */
function _mapFloodStatistics(
  raw: Record<string, unknown> | undefined,
  fallbackRiskLevel: string
): FloodStatistics {
  const r = raw ?? {}
  return {
    ...(r as object),
    totalArea: (r.totalArea as number) ?? (r.floodArea as number) ?? 0,
    riskLevel: (r.riskLevel as string) ?? fallbackRiskLevel,
    affectedCount: (r.affectedCount as number) ?? (r.affectedFacilities as number) ?? 0,
  } as FloodStatistics
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

export const floodAdapter = {
  get dataSource(): string {
    return _dataSource
  },

  setDataSource(mode: 'mock' | 'api'): void {
    if (mode !== 'mock' && mode !== 'api') {
      throw new Error(`[FloodAdapter] 无效的数据源模式: ${mode}，仅支持 'mock' 或 'api'`)
    }
    _dataSource = mode
    logger.info(`[FloodAdapter] 数据源切换为: ${mode}`)
  },

  async getWaterArea(): Promise<[number, number][]> {
    if (_dataSource === 'mock') {
      return _fetchMockWaterArea()
    }
    // api 模式：从后端获取水域坐标（复用 mock 静态数据，后端无此端点）
    return _fetchMockWaterArea()
  },

  async getFloodAnalysis(
    waterLevel: number,
    { signal }: RequestOptions = {}
  ): Promise<FloodAnalysisResult> {
    if (_dataSource === 'mock') {
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
      apiRequest<{ code: number; data: Record<string, unknown> }>(
        `/flood/flood-areas?waterLevel=${waterLevel}`,
        { signal }
      ),
      apiRequest<{ code: number; data: Record<string, unknown> }>(
        `/flood/flood-statistics?waterLevel=${waterLevel}`,
        { signal }
      ),
    ])

    const floodData = floodAreasRes.data as Record<string, unknown> | undefined
    const riskLevel = (floodData?.riskLevel as string) || '无风险'
    const actualWaterLevel = floodData?.actualWaterLevel as number | undefined

    return {
      features: _mapFloodFeatures(floodData?.features, riskLevel),
      statistics: _mapFloodStatistics(statisticsRes.data as Record<string, unknown>, riskLevel),
      riskLevel,
      actualWaterLevel,
    }
  },

  async getImpactAssessment(
    waterLevel: number,
    { signal }: RequestOptions = {}
  ): Promise<ImpactAssessmentResult> {
    if (_dataSource === 'mock') {
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
    const res = await apiRequest<{ code: number; data: Record<string, unknown> }>(
      '/flood/analysis/disaster',
      {
        method: 'POST',
        body: JSON.stringify({ waterLevel }),
        signal,
      }
    )

    const result = res.data as Record<string, unknown> | undefined
    const totalLoss = (result?.totalLoss as number) || 0
    return {
      affectedFacilities: _mapAffectedFacilities(result?.affectedFacilities, totalLoss),
      totalLoss,
    }
  },

  async getDEM(_region: unknown): Promise<Record<string, string>> {
    // DEM 管线未就绪，无论哪种模式均返回 mock 标注
    return { source: 'mock', note: 'DEM 管线待接入（A 路线增量③）' }
  },

  clearCache(): void {
    _cachedWaterAreaCoords = null
  },
}
