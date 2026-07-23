import type { FacilityType, TypeSetting } from './facility'
import type { SavedXiaoqu } from './xiaoqu'

// 方案（后端 plans.json 中的一条记录）
export interface Plan {
  id: string
  userId: string
  name: string
  selectedKeys: string[] // 不强约束 FacilityType[]，因为旧数据可能有不一致
  typeSettings: Record<string, TypeSetting>
  savedXiaoqu: SavedXiaoqu[]
  createdAt: string
  updatedAt: string
  /** 业务类型：'flood' | 'site-selection' | undefined（旧数据无此字段） */
  businessType?: string
  /** 浸没方案水位（仅 flood 类型有值） */
  waterLevel?: number
  /** 浸没方案统计数据（仅 flood 类型有值） */
  floodStatistics?: any
  /** 浸没方案特征数据（仅 flood 类型有值） */
  floodFeatures?: any[]
  /** 浸没方案受影响设施（仅 flood 类型有值） */
  affectedFacilities?: any[]
  /** 浸没方案总损失（仅 flood 类型有值） */
  totalLoss?: number
  /** 浸没方案风险等级（仅 flood 类型有值，BUGFIX-P2-03） */
  floodRiskLevel?: string
}

// 创建方案参数
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
