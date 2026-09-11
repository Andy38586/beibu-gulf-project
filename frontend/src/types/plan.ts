import type { TypeSetting } from './facility'
import type {
  AffectedFacilityParsed,
  FloodFeatureParsed,
  FloodStatisticsResponseParsed,
} from './schemas'
import type { SavedXiaoqu } from './xiaoqu'

// 重新导出类型，方便其他模块引用
export type { SavedXiaoqu } from './xiaoqu'

// 方案（后端 plans 表 payload 的一条记录；浸没系字段经 planSchema 元素级校验，审查 M-1）
export interface Plan {
  id: string
  userId: string
  name: string
  selectedKeys: string[] // 不强约束 FacilityType[]，因为旧数据可能有不一致
  typeSettings: Record<string, TypeSetting>
  // 改可选对齐运行时（存量 plans.json 记录大多无此字段，消费方 `|| []` 兜底）
  savedXiaoqu?: SavedXiaoqu[]
  /** 选址权重（后端 plansController 持久化；旧数据 null，前端当前不消费） */
  weights?: Record<string, number> | null
  createdAt: string
  updatedAt: string
  /** 业务类型：'flood' | 'site-selection' | undefined（旧数据无此字段） */
  businessType?: string
  /** 浸没方案水位（仅 flood 类型有值） */
  waterLevel?: number
  /** 浸没方案统计数据（planSchema 按 floodStatisticsResponseSchema 校验） */
  floodStatistics?: FloodStatisticsResponseParsed
  /** 浸没方案特征数据（planSchema 按 floodFeatureSchema 元素级校验） */
  floodFeatures?: FloodFeatureParsed[]
  /** 浸没方案受影响设施（planSchema 按 affectedFacilitySchema 元素级校验） */
  affectedFacilities?: AffectedFacilityParsed[]
  /** 浸没方案总损失（仅 flood 类型有值） */
  totalLoss?: number
  /** 浸没方案风险等级（仅 flood 类型有值） */
  floodRiskLevel?: string
}

export interface CreatePlanParams {
  name: string
  selectedKeys: string[]
  typeSettings: Record<string, TypeSetting>
}

// 更新方案参数
export interface UpdatePlanParams {
  name?: string
  selectedKeys?: string[]
  typeSettings?: Record<string, TypeSetting>
}
