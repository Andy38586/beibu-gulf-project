/**
 * floodAdapter — 浸没分析数据适配器，隔离业务层与数据源。
 * fetch 模式走 Nest 后端 /flood/* 查表；calculate 模式走 algorithm-service FastAPI 实时演算。
 * 静态数据已移交后端，字段由后端对齐类型契约，前端不再做字段映射。
 */

import { BoundedMap, ENDPOINTS, logger, useApiRequest } from '@/shared'
import type { AffectedFacility, FloodFeature, FloodStatistics } from '@/types/business/base'
import type {
  FloodAreasResponseParsed,
  FloodDisasterResponseParsed,
  FloodImpactResponseParsed,
  FloodOnlineResponseParsed,
  FloodStatisticsResponseParsed,
} from '@/types/schemas'
import {
  floodAreasResponseSchema,
  floodDisasterResponseSchema,
  floodImpactResponseSchema,
  floodOnlineResponseSchema,
  floodStatisticsResponseSchema,
  waterAreaSchema,
} from '@/types/schemas'

// 数据源模式：fetch（业务后端查表/查静态数据）/ calculate（FastAPI 实时演算）；原统一 dataSourceConfig 仅此一个使用方，简化为模块级变量
// 命名收敛：查表=fetch、实时演算=calculate（替代旧 api/online 语义不变）
type FloodDataSourceMode = 'fetch' | 'calculate'
let dataSource: FloodDataSourceMode = 'fetch'

const { apiRequest } = useApiRequest()

// calculate 档位缓存：round(level,1) 同档位秒回，消除重复档位的整条请求+重绘链路；
// 规模与后端 LRU 一致（64 档），上限淘汰由 BoundedMap 按插入序处理（原手写 size 检查已收敛）
const MAX_CALCULATE_LEVEL_CACHE = 64
const _calculateLevelCache = new BoundedMap<number, FloodAnalysisResult>(MAX_CALCULATE_LEVEL_CACHE)

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

// riskLevel 双模式均由后端权威输出（fetch 模式 Nest 注入、calculate 模式 FastAPI
// _risk_level 输出，两端口径同表），前端不持有风险阈值表——原 _riskLevelFromFlood
// 双实现是跨端漂移源，已删

/** 调用 FastAPI 实时演算（vite proxy /flood-online → localhost:8000），统一入口 useApiRequest（envelope:false——FastAPI 返回裸 JSON 无信封） */
async function _fetchOnlineFlood(
  waterLevel: number,
  signal?: AbortSignal
): Promise<{
  level: number
  riskLevel: string
  featureCount: number
  floodedKm2: number
  features: FloodFeature[]
}> {
  const raw = await apiRequest<FloodOnlineResponseParsed>(ENDPOINTS.flood.online, {
    method: 'GET',
    // b027：参数名统一 waterLevel（原 level 与 fetch 模式分裂；FastAPI 端已同步改名）
    params: { waterLevel },
    signal,
    envelope: false,
    // 校验交给 apiRequest 的 schema 选项（zod schema=运行时数据校验；envelope:false 时校验裸响应，无需手动 safeParse）
    schema: floodOnlineResponseSchema,
  })
  // D1：schema 已对 features 元素深校验（geometry/coordinates 形状）；riskLevel 为
  // 后端权威字段（schema 必校验）。此处断言仅为类型收窄（z.infer 派生类型与业务类型同源）
  return raw as {
    level: number
    riskLevel: string
    featureCount: number
    floodedKm2: number
    features: FloodFeature[]
  }
}

export const floodAdapter = {
  get dataSource(): string {
    return dataSource
  },

  // fetch=业务后端查表/查静态数据（Express/Nest）/ calculate=FastAPI 实时演算
  setDataSource(mode: 'fetch' | 'calculate'): void {
    dataSource = mode
  },

  // signal：请求可随组件卸载/新请求取消
  async getWaterArea(signal?: AbortSignal): Promise<[number, number][]> {
    // 水域坐标只读端点（数据已收归后端，前端 water-area.json 已删，仅此一条链路）
    const coords = await apiRequest<[number, number][]>(ENDPOINTS.flood.waterArea, {
      schema: waterAreaSchema,
      signal,
    })
    return coords
  },

  async getFloodAnalysis(
    waterLevel: number,
    { signal }: RequestOptions = {}
  ): Promise<FloodAnalysisResult> {
    // calculate：FastAPI 连通性淹没实时演算，adapter 隔离保证业务层零改动
    if (dataSource === 'calculate') {
      // 档位缓存：同档位直接复用上次结果（滑块来回拖秒回，不重发请求不重绘）
      const levelKey = Math.round(waterLevel * 10) / 10
      const hit = _calculateLevelCache.get(levelKey)
      if (hit) {
        logger.debug(`[floodAdapter] calculate 缓存命中档位 ${levelKey}`)
        return hit
      }

      const data = await _fetchOnlineFlood(waterLevel, signal)
      logger.info(
        `[floodAdapter] calculate 演算完成: 请求=${waterLevel}m 实际档=${data.level}m 面积=${data.floodedKm2}km² 要素=${data.featureCount}`
      )
      // schema 已要求 floodedKm2/level 必为有限数字（z.number() 连 NaN 也拒绝），
      // 缺失/坏值在 HTTP 边界即抛 REQUEST_FAILED，此处无需兜底
      // riskLevel 后端权威输出（前端阈值表已删，两模式同源）
      const riskLevel = data.riskLevel
      // D1：schema 已深校验；此处仅补 riskLevel 注入 properties（类型收窄，非穿透）
      const features = (data.features ?? []).map((f) => ({
        ...f,
        properties: { ...f.properties, riskLevel },
      })) as FloodFeature[]
      const result: FloodAnalysisResult = {
        features,
        statistics: {
          floodArea: data.floodedKm2,
          riskLevel,
          // affectedCount 占位死字段已移除（无业务消费，类型 optional）
        },
        riskLevel,
        actualWaterLevel: data.level,
      }
      // 上限淘汰由 BoundedMap 内部按插入序处理（原手写 FIFO 检查已收敛）
      _calculateLevelCache.set(levelKey, result)
      return result
    }
    // fetch：并行取淹没范围 + 统计；后端已按类型契约返回（riskLevel/字段名一致），直接透传
    logger.debug(`[floodAdapter] fetch 数据源请求: 水位=${waterLevel}m`)
    const [floodAreasRes, statisticsRes] = await Promise.all([
      apiRequest<FloodAreasResponseParsed>(ENDPOINTS.flood.floodAreas, {
        params: { waterLevel },
        signal,
        schema: floodAreasResponseSchema,
      }),
      apiRequest<FloodStatisticsResponseParsed>(ENDPOINTS.flood.statistics, {
        params: { waterLevel },
        signal,
        schema: floodStatisticsResponseSchema,
      }),
    ])

    const floodData = floodAreasRes
    const riskLevel = floodData?.riskLevel ?? '无风险'
    const actualWaterLevel = floodData?.actualWaterLevel

    return {
      // D1：schema 已深校验 features 元素；riskLevel 由后端注入（flood-areas 响应 properties 恒含），
      // 单断言仅为类型收窄（z.infer 派生类型与业务类型同源）
      features: (floodData?.features as FloodFeature[]) || [],
      // z.infer 同源：schema 解析类型与业务类型字段兼容，单断言透传（原 as unknown as 双断言消除）
      statistics: statisticsRes as FloodStatistics,
      riskLevel,
      actualWaterLevel,
    }
  },

  async getImpactAssessment(
    waterLevel: number,
    { signal }: RequestOptions = {}
  ): Promise<ImpactAssessmentResult> {
    // calculate：FastAPI 预计算档位表 → 空间筛选设施影响
    if (dataSource === 'calculate') {
      logger.debug(`[floodAdapter] impact calculate: 水位=${waterLevel}m`)
      const res = await apiRequest<FloodImpactResponseParsed>(ENDPOINTS.flood.impact, {
        // b027：参数名统一 waterLevel
        params: { waterLevel },
        signal,
        // FastAPI 返回裸 JSON（无 envelope），与 getFloodAnalysis calculate 分支一致
        envelope: false,
        schema: floodImpactResponseSchema,
      })
      // D1：schema 已深校验 affectedFacilities 元素字段
      return {
        affectedFacilities: res?.affectedFacilities ?? [],
        totalLoss: res?.totalLoss ?? 0,
      }
    }
    // api：调用后端 /flood/analysis/disaster；后端已返回全字段，schema 深校验后直接透传
    const res = await apiRequest<FloodDisasterResponseParsed>(ENDPOINTS.flood.disaster, {
      method: 'POST',
      body: JSON.stringify({ waterLevel }),
      signal,
      schema: floodDisasterResponseSchema,
    })

    return {
      affectedFacilities: res?.affectedFacilities ?? [],
      totalLoss: res?.totalLoss ?? 0,
    }
  },

  clearCache(): void {
    _calculateLevelCache.clear()
  },
}
