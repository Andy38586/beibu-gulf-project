import type { Plan } from './plan'
import type { AnalysisResult } from './analysis'

// 认证相关
export interface User {
  id: string
  username: string
  createdAt: string
}

export interface AuthResponse {
  token: string
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
