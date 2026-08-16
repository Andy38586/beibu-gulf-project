import type { TypeSetting } from './facility'
import type { SavedXiaoqu } from './xiaoqu'

// 重新导出类型，方便其他模块引用
export type { SavedXiaoqu } from './xiaoqu'

// 方案（后端 plans.json 中的一条记录）
export interface Plan {
  id: string
  userId: string
  name: string
  selectedKeys: string[] // 不强约束 FacilityType[]，因为旧数据可能有不一致
  typeSettings: Record<string, TypeSetting>
  // 816-专项3-0816-03：改可选对齐运行时（存量 plans.json 记录大多无此字段，消费方 `|| []` 兜底）
  savedXiaoqu?: SavedXiaoqu[]
  /** 816-专项3-0816-04：选址权重（后端 plansController 持久化；旧数据 null，前端当前不消费） */
  weights?: Record<string, number> | null
  createdAt: string
  updatedAt: string
  /** 业务类型：'flood' | 'site-selection' | undefined（旧数据无此字段） */
  businessType?: string
  /** 浸没方案水位（仅 flood 类型有值） */
  waterLevel?: number
  /** 浸没方案统计数据（仅 flood 类型有值，格式待稳定） */
  floodStatistics?: Record<string, unknown>
  /** 浸没方案特征数据（仅 flood 类型有值，格式待稳定） */
  floodFeatures?: Record<string, unknown>[]
  /** 浸没方案受影响设施（仅 flood 类型有值，格式待稳定） */
  affectedFacilities?: Record<string, unknown>[]
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
