/**
 * floodAdapter — 浸没分析数据适配器，隔离业务层与数据源。
 * api 模式走 Express 后端 /flood/*；online 模式走 flood-service FastAPI 实时演算。
 * 静态数据已移交后端，字段由后端对齐类型契约，前端不再做字段映射。
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

// 数据源模式：api（Express 后端）/ online（FastAPI 实时演算）；原统一 dataSourceConfig 仅此一个使用方，简化为模块级变量
type FloodDataSourceMode = 'api' | 'online'
let dataSource: FloodDataSourceMode = 'api'

const { apiRequest } = useApiRequest()

// online 档位缓存：round(level,1) 同档位秒回，消除重复档位的整条请求+重绘链路；规模与后端 LRU 一致（64 档），FIFO 淘汰
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
 * online 模式风险等级：按淹没面积 + 水位双因子分段，阈值配合实测数据
 * （0.5m≈652km² 低、2.0m≈2593km² 中、3.5m≈4539km² 中、8.0m≈10943km² 高）
 */
function _riskLevelFromFlood(floodedKm2: number, level: number): string {
  if (floodedKm2 <= 0) return '无风险'
  if (floodedKm2 >= 6000 || level >= 6) return '高风险'
  if (floodedKm2 >= 2000 || level >= 3) return '中风险'
  return '低风险'
}

/** 调用 FastAPI 实时演算（vite proxy /flood-online → localhost:8000），统一入口 useApiRequest（envelope:false——FastAPI 返回裸 JSON 无信封） */
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
    // 校验交给 apiRequest 的 schema 选项（zod schema=运行时数据校验；envelope:false 时校验裸响应，无需手动 safeParse）
    schema: floodOnlineResponseSchema,
  })
  // features 元素形状由下游 map + as FloodFeature[] 收窄
  return raw as {
    level: number
    featureCount: number
    floodedKm2: number
    features: FloodFeature[]
  }
}

export const floodAdapter = {
  get dataSource(): string {
    return dataSource
  },

  // api=Express 后端 / online=FastAPI 实时演算
  setDataSource(mode: 'api' | 'online'): void {
    dataSource = mode
  },

  // signal：请求可随组件卸载/新请求取消
  async getWaterArea(signal?: AbortSignal): Promise<[number, number][]> {
    // 水域坐标只读端点（数据已收归后端，前端 water-area.json 已删，仅此一条链路）
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
    // online：FastAPI 连通性淹没实时演算，adapter 隔离保证业务层零改动
    if (dataSource === 'online') {
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
          // floodArea(km²)：面板依赖此字段，缺失会静默显示 0 km²
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
    // api：并行取淹没范围 + 统计；后端已按类型契约返回（riskLevel/字段名一致），直接透传
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
      // statistics 经 schema 校验后透传；Record → FloodStatistics 需 unknown 中转（TS2352）
      statistics: statisticsRes as unknown as FloodStatistics,
      riskLevel,
      actualWaterLevel,
    }
  },

  async getImpactAssessment(
    waterLevel: number,
    { signal }: RequestOptions = {}
  ): Promise<ImpactAssessmentResult> {
    // online：FastAPI 预计算档位表 → 空间筛选设施影响
    if (dataSource === 'online') {
      const res = await apiRequest<Record<string, unknown>>('/flood-online/api/flood/impact', {
        params: { level: waterLevel },
        signal,
        // FastAPI 返回裸 JSON（无 envelope），与 getFloodAnalysis online 分支一致
        envelope: false,
      })
      const result = res as Record<string, unknown> | undefined
      const affectedFacilities = (result?.affectedFacilities as AffectedFacility[]) || []
      const totalLoss = (result?.totalLoss as number) || 0
      return { affectedFacilities, totalLoss }
    }
    // api：调用后端 /flood/analysis/disaster；后端已返回全字段，直接透传
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
