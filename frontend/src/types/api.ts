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

// 2026-10-21 删 `token?`：生产零读，认证已改由 HttpOnly Cookie 承载。
export interface AuthResponse {
  user: User
}

// 注（2026-10-12 删）：此处原有 `export interface ApiError { error: string }`，
// 全仓零 importer，且与 `@/shared` 的 `ApiError` **class** 撞名（B2：同一实体只能有一处
// 类型定义）。经 `types/index.ts` 星导出后，`import { ApiError } from '@/types'` 会拿到这个
// 空壳接口而非真 class —— 是误用温床。HTTP 错误一律用 shared 的 class。
