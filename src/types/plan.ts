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
