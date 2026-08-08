/**
 * Flood Data Adapter
 * 职责：隔离浸没分析业务层与数据源。
 * 业务层（FloodAnalysisPage）通过此 Adapter 获取数据。
 * 数据链路（2026-08-08 数据搬后端后）：
 * - api 模式：Express 后端 /flood/* 端点（floodArea/floodStatistics/water-area/analysis/disaster）
 * - online 模式：flood-service FastAPI 实时演算（/flood-online/api/flood/*）
 * static 模式与字段映射层已删除——前端静态 JSON 全部移交后端，字段由后端对齐类型契约。
 */

import { useApiRequest } from '@/shared'
import type { AffectedFacility, FloodFeature, FloodStatistics } from '@/types/business/base'
import {
  floodAreasResponseSchema,
  floodDisasterResponseSchema,
  floodOnlineResponseSchema,
  floodStatisticsResponseSchema,
  waterAreaSchema,
} from '@/types/schemas'

import { resolveDataSource, setAdapterDataSource } from '../dataSourceConfig'

// ==================== 数据源配置（委托给统一 dataSourceConfig） ====================

const { apiRequest } = useApiRequest()

const ADAPTER_NAME = 'flood'

// 档位结果缓存（online，2026-08-06 性能优化②）：round(level,1) 同档位秒回——
// 滑块来回拖/重复档位不重发请求、不重绘淹没多边形（FastAPI 有后端 LRU，
// 但前端每档仍全量请求+全量重建 entity，此缓存消除重复档位的整条链路）；
// 规模与后端 LRU 一致（64 档），FIFO 淘汰
const _onlineLevelCache = new Map<number, FloodAnalysisResult>()
const MAX_ONLINE_LEVEL_CACHE = 64

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
 * 经统一入口 useApiRequest（envelope: false——FastAPI 返回裸 JSON 无信封,
 * 统一入口规则仍生效,禁止裸 fetch）
 * 用 floodOnlineResponseSchema.safeParse 替代裸 `res.json() as {...}` 隐式断言 */
async function _fetchOnlineFlood(
  waterLevel: number,
  signal?: AbortSignal
): Promise<{
  level: number
  featureCount: number
  floodedKm2: number
  features: FloodFeature[]
}> {
  const raw = await apiRequest<unknown>('/flood-online/api/flood/online', {
    method: 'GET',
    params: { level: waterLevel },
    signal,
    envelope: false,
    // P0-1 统一入口：校验交给 apiRequest 的 schema 选项（envelope:false → 校验的是裸响应),
    // 与其余 16 处 schema 接入保持一致,去掉手动 safeParse
    schema: floodOnlineResponseSchema,
  })
  // features 元素类型由下游 map+as FloodFeature[] 收窄（与原裸 `res.json()` 一致的元素处理）
  return raw as {
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

  // 类型补全 'online'（2026-08-06：原仅 'static'|'api'，与 DataSourceMode 三值不符——
  // 与 main.ts:38 断言漏 'online' 同源；运行时本就支持 online（VITE_DATA_SOURCE=online））
  setDataSource(mode: 'api' | 'online'): void {
    setAdapterDataSource(ADAPTER_NAME, mode)
  },

  // b046: 增加 signal 参数——水域坐标请求可随组件卸载/新请求取消
  async getWaterArea(signal?: AbortSignal): Promise<[number, number][]> {
    // 后端只读端点获取水域坐标（D-4=A：后端 /flood/water-area 端点，
    // 原与前端 water-area.json 同源，2026-08-08 数据搬后端后前端文件删除，仅此一条链路）
    const coords = await apiRequest<[number, number][]>('/flood/water-area', {
      schema: waterAreaSchema,
      signal,
    })
    return coords
  },

  async getFloodAnalysis(
    waterLevel: number,
    { signal }: RequestOptions = {}
  ): Promise<FloodAnalysisResult> {
    // online 模式：FastAPI 实时演算（连通性淹没），业务层零改动（N4 adapter 隔离）
    if (resolveDataSource(ADAPTER_NAME) === 'online') {
      // 档位缓存：同档位直接复用上次结果（滑块来回拖秒回，不重发请求不重绘）
      const levelKey = Math.round(waterLevel * 10) / 10
      const hit = _onlineLevelCache.get(levelKey)
      if (hit) return hit

      const data = await _fetchOnlineFlood(waterLevel, signal)
      const riskLevel = _riskLevelFromFlood(data.floodedKm2 ?? 0, data.level ?? waterLevel)
      const features = (data.features ?? []).map((f) => ({
        ...f,
        properties: { ...f.properties, riskLevel },
      })) as FloodFeature[]
      const result: FloodAnalysisResult = {
        features,
        statistics: {
          totalArea: Math.round((data.floodedKm2 ?? 0) * 1e6), // km² → m²
          // P0-3: 补 floodArea(km²)——FloodAnalysisReportPanel 读的是 floodArea,
          // 原 online 分支缺失导致面板显示 0 km²(被 || 0 静默掩盖)
          floodArea: data.floodedKm2 ?? 0,
          riskLevel,
          affectedCount: 0,
        },
        riskLevel,
        actualWaterLevel: data.level,
      }
      // FIFO 淘汰（与后端 64 档 LRU 同规模）；先淘汰最旧再插入
      if (_onlineLevelCache.size >= MAX_ONLINE_LEVEL_CACHE) {
        const oldestKey = _onlineLevelCache.keys().next().value
        if (oldestKey !== undefined) _onlineLevelCache.delete(oldestKey)
      }
      _onlineLevelCache.set(levelKey, result)
      return result
    }
    // api 模式：调用后端 /flood/flood-areas + /flood/flood-statistics
    // （后端已按类型契约返回：features.properties 含 riskLevel、statistics 字段名一致——
    // 原 _mapFloodFeatures/_mapFloodStatistics 映射层已删除，直接透传）
    const [floodAreasRes, statisticsRes] = await Promise.all([
      apiRequest<Record<string, unknown>>('/flood/flood-areas', {
        params: { waterLevel },
        signal,
        schema: floodAreasResponseSchema,
      }),
      apiRequest<Record<string, unknown>>('/flood/flood-statistics', {
        params: { waterLevel },
        signal,
        schema: floodStatisticsResponseSchema,
      }),
    ])

    const floodData = floodAreasRes as Record<string, unknown> | undefined
    const riskLevel = (floodData?.riskLevel as string) || '无风险'
    const actualWaterLevel = floodData?.actualWaterLevel as number | undefined

    return {
      features: (floodData?.features as FloodFeature[]) || [],
      // 后端 statistics 字段与类型契约一致（floodArea/averageDepth/...），
      // 经 schema 校验后透传；Record → FloodStatistics 需 unknown 中转（TS2352）
      statistics: statisticsRes as unknown as FloodStatistics,
      riskLevel,
      actualWaterLevel,
    }
  },

  async getImpactAssessment(
    waterLevel: number,
    { signal }: RequestOptions = {}
  ): Promise<ImpactAssessmentResult> {
    // online 模式：FastAPI 预计算档位表 → 空间筛选设施影响（2026-08-06 补齐，
    // 原实现返回空——受影响设施/损失一直为空的洞）
    if (resolveDataSource(ADAPTER_NAME) === 'online') {
      const res = await apiRequest<Record<string, unknown>>('/flood-online/api/flood/impact', {
        params: { level: waterLevel },
        signal,
        // FastAPI 返回裸 JSON（无 {code,data} 信封），与 getFloodAnalysis online 分支一致
        envelope: false,
      })
      const result = res as Record<string, unknown> | undefined
      const affectedFacilities = (result?.affectedFacilities as AffectedFacility[]) || []
      const totalLoss = (result?.totalLoss as number) || 0
      return { affectedFacilities, totalLoss }
    }
    // api 模式：调用后端 /flood/analysis/disaster
    // （后端 assessDisaster 已返回 lng/lat/loss/damageRate 全字段，
    // 原 _mapAffectedFacilities + IMPACT_DAMAGE_RATE 映射层已删除，直接透传）
    const res = await apiRequest<Record<string, unknown>>('/flood/analysis/disaster', {
      method: 'POST',
      body: JSON.stringify({ waterLevel }),
      signal,
      schema: floodDisasterResponseSchema,
    })

    const result = res as Record<string, unknown> | undefined
    const totalLoss = (result?.totalLoss as number) || 0
    return {
      affectedFacilities: (result?.affectedFacilities as AffectedFacility[]) || [],
      totalLoss,
    }
  },

  clearCache(): void {
    _onlineLevelCache.clear()
  },
}
