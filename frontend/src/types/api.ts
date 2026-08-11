import type { AnalysisResult } from './analysis'
import type { Plan } from './plan'

// 认证相关
export interface User {
  id: string
  username: string
  createdAt: string
}

export interface AuthResponse {
  /** @deprecated：token 已移至 HttpOnly Cookie，响应体不再回传 */
  token?: string
  user: User
}

// API 错误响应
export interface ApiError {
  error: string
}

// 方案列表响应
export type PlansResponse = Plan[]

// 分析 API 响应（就是 AnalysisResult）
export type AnalysisApiResponse = AnalysisResult
