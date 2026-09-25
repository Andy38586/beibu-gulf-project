// 认证相关
export interface User {
  id: string
  username: string
  /**
   * 与后端 `AuthUserView.createdAt` 一致：`users.created_at` 列当前可空（历史数据）。
   * 🔴 2026-09-19 修复 P0：此前此处与 `userSchema` 都写必填 `string`，与后端视图不符，
   * 导致 `/auth/me` 响应过不了 zod、带有效 Cookie 刷新即被登出。如实标注 nullable。
   */
  createdAt: string | null
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
