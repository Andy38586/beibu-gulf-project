import type { TypeSetting } from './analysis'

export interface Plan {
  id: string
  name: string
  typeSettings: Record<string, TypeSetting>
  createdAt: string
  updatedAt?: string
}

export interface CreatePlanParams {
  name: string
  typeSettings: Record<string, TypeSetting>
}

export interface UpdatePlanParams {
  id: string
  name: string
  typeSettings: Record<string, TypeSetting>
}
