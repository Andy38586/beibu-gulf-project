/**
 * floodAdapter — 浸没分析数据适配器，隔离业务层与数据源。
 * 2026-09-10（阶段 4）：algorithm-service（FastAPI）退役，原 fetch/calculate 双模式
 * 收敛为单模式 —— 全部走 Nest 后端 /flood/*（251 档查表已落 PostGIS）。
 * 原 calculate 分支（FastAPI 实时演算 + 档位缓存）与 dataSource/setDataSource
 * 策略模式一并移除：生产恒为 fetch（.env.production），本地 dev 经 .env.local
 * 覆盖为 calculate 的旧路径已无后端可连。静态数据字段由后端对齐类型契约。
 */

import { ENDPOINTS, logger, useApiRequest } from '@/shared'
import type { AffectedFacility, FloodFeature, FloodStatistics } from '@/types/business/base'
import type {
  FloodAreasResponseParsed,
  FloodDisasterResponseParsed,
  FloodStatisticsResponseParsed,
} from '@/types/schemas'
import {
  floodAreasResponseSchema,
  floodDisasterResponseSchema,
  floodStatisticsResponseSchema,
  waterAreaSchema,
} from '@/types/schemas'

const { apiRequest } = useApiRequest()

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

// riskLevel 由后端权威输出（Nest 注入，阈值表在 flood.constants.ts 单一事实源），
// 前端不持有风险阈值表——原 _riskLevelFromFlood 双实现是跨端漂移源，已删

export const floodAdapter = {
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
    // 并行取淹没范围 + 统计；后端已按类型契约返回（riskLevel/字段名一致），直接透传
    logger.debug(`[floodAdapter] 请求: 水位=${waterLevel}m`)
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
    // 调用后端 /flood/analysis/disaster；后端已返回全字段，schema 深校验后直接透传
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
}
