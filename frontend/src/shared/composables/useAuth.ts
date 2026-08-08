import type { Ref } from 'vue'
import { ref } from 'vue'

import { logger } from '@/shared/utils/logger'
import type { AuthResponse, User } from '@/types/api'
import { authResponseSchema, userSchema } from '@/types/schemas'

import { useApiRequest } from './useApiRequest'

/** localStorage 键：持久化用户信息 */
const USER_STORAGE_KEY = 'beibu-gulf-user'

/**
 * 从 localStorage 读取用户信息
 * 用 userSchema.safeParse 替代裸 `as User` 断言，校验失败清缓存返回 null
 */
function readStoredUser(): User | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(USER_STORAGE_KEY)
    if (!stored) return null
    // safeParse 替代 JSON.parse(stored) as User
    const result = userSchema.safeParse(JSON.parse(stored))
    if (!result.success) {
      logger.warn('[useAuth] localStorage 用户数据校验失败，已清除:', result.error.issues)
      window.localStorage.removeItem(USER_STORAGE_KEY)
      return null
    }
    return result.data as User
  } catch {
    return null
  }
}

/**
 * 将用户信息写入 localStorage
 */
function writeStoredUser(user: User | null): void {
  if (typeof window === 'undefined') return
  try {
    if (user) {
      window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user))
    } else {
      window.localStorage.removeItem(USER_STORAGE_KEY)
    }
  } catch {
    // 忽略隐私模式等写入失败场景
  }
}

// 模块级别单例状态，确保所有组件共享同一状态
const user: Ref<User | null> = ref(readStoredUser())
const { apiRequest, token, isAuthenticated, setToken, clearToken } = useApiRequest()

// 多标签页状态同步 - 全局单例监听（由 App.vue 启动时一次性注册）
let storageListenerRegistered = false

// 认证恢复标志，防止重复调用
let authRestored = false

/**
 * 应用启动时恢复认证状态（d033：始终以 Cookie 为权威）
 * 无论 localStorage 有无 user，均尝试 /auth/me 验证 Cookie
 */
async function restoreAuth(): Promise<User | null> {
  // 防止重复调用
  if (authRestored) {
    return user.value
  }
  authRestored = true

  try {
    const data = await apiRequest<{ user: User }>('/auth/me', { schema: authResponseSchema })
    if (data && data.user) {
      user.value = data.user
      writeStoredUser(data.user)
      // Cookie 有效，设置占位 token 启用 isAuthenticated
      setToken('restored-from-cookie')
      return data.user
    }
  } catch {
    // Cookie 无效或过期，清除前端状态
    clearToken()
    user.value = null
    writeStoredUser(null)
  }
  return null
}

/**
 * 多标签页同步 - 监听 beibu-gulf-user 变化
 * 其他标签页写入的用户数据同样经 userSchema 校验，失败则视为登出
 */
function handleStorageChange(event: StorageEvent): void {
  if (event.key === USER_STORAGE_KEY) {
    if (event.newValue === null) {
      // 其他标签页登出了，当前标签页也要登出（store 重置由 App.vue watch(user) 驱动）
      user.value = null
      clearToken()
    } else {
      // 其他标签页登录了，当前标签页也要同步
      try {
        const result = userSchema.safeParse(JSON.parse(event.newValue))
        if (result.success) {
          user.value = result.data as User
        } else {
          logger.warn('[useAuth] storage 同步数据校验失败:', result.error.issues)
          user.value = null
        }
      } catch {
        user.value = null
      }
    }
  }
}

// store 重置（2026-08-08 P9）：不再用 setResetStoresHandler 注册回调——
// 重置逻辑移到 App.vue 组件内，用 watch(user) 驱动（user 变 null → 重置）。
// 此处删除模块级 resetHandler，消除"重置逻辑藏在注册时序里"的耦合。

/**
 * 注册多标签页 storage 同步监听（仅执行一次）
 * 应在 App.vue onMounted 中调用，无需组件上下文，不会抛错
 */
export function initAuthStorageListener(): void {
  if (storageListenerRegistered || typeof window === 'undefined') return
  storageListenerRegistered = true
  window.addEventListener('storage', handleStorageChange)
}

/**
 * 解除多标签页 storage 监听（与 initAuthStorageListener 配对）
 * 由 App.vue onUnmounted 调用
 */
export function removeAuthStorageListener(): void {
  if (!storageListenerRegistered) return
  storageListenerRegistered = false
  window.removeEventListener('storage', handleStorageChange)
}

export function useAuth() {
  async function login(username: string, password: string): Promise<User> {
    const data = await apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      schema: authResponseSchema,
    })
    if (!data || !data.user) {
      throw new Error('登录响应数据无效')
    }
    // token 由 HttpOnly Cookie 携带，前端仅设占位符启用 isAuthenticated
    setToken('cookie-auth')
    user.value = data.user
    writeStoredUser(data.user)
    return data.user
  }

  async function register(username: string, password: string): Promise<User> {
    const data = await apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      schema: authResponseSchema,
    })
    if (!data || !data.user) {
      throw new Error('注册响应数据无效')
    }
    // 同 login，token 走 Cookie
    setToken('cookie-auth')
    user.value = data.user
    writeStoredUser(data.user)
    return data.user
  }

  /**
   * 登出时调用后端API清除Cookie
   */
  async function logout(): Promise<void> {
    try {
      // 调用后端登出接口，清除HttpOnly Cookie
      await apiRequest('/auth/logout', { method: 'POST' })
    } catch (error) {
      // 即使后端调用失败，也清理前端状态
      logger.debug('登出接口调用失败，但仍清理前端状态:', error)
    } finally {
      // 清理前端状态（store 重置由 App.vue watch(user) 驱动）
      clearToken()
      user.value = null
      writeStoredUser(null)
      // 重置认证恢复标志，允许下次重新恢复
      authRestored = false
    }
  }

  return { user, token, isAuthenticated, login, register, logout, restoreAuth }
}
