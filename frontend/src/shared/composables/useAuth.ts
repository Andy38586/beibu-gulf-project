import type { ComputedRef, Ref } from 'vue'
import { ref } from 'vue'

import { logger } from '@/shared/utils/logger'
import type { AuthResponse, User } from '@/types/api'
import { authResponseSchema, userSchema } from '@/types/schemas'

import { useApiRequest } from './useApiRequest'

/** 返回契约（816-专项3-0816-13：显式化，防重构时签名静默漂移） */
export interface UseAuthReturn {
  user: Ref<User | null>
  token: Ref<string>
  isAuthenticated: ComputedRef<boolean>
  login: (username: string, password: string) => Promise<User>
  register: (username: string, password: string) => Promise<User>
  logout: () => Promise<void>
  restoreAuth: () => Promise<User | null>
}

/** localStorage 键：持久化用户信息 */
const USER_STORAGE_KEY = 'beibu-gulf-user'

/** 读取 localStorage 用户信息：经 schema 运行时校验，失败即清缓存返回 null */
function readStoredUser(): User | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(USER_STORAGE_KEY)
    if (!stored) return null
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

/** 写入 localStorage（传 null 清除） */
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

// 模块级单例状态：所有组件共享同一认证状态
const user: Ref<User | null> = ref(readStoredUser())
const { apiRequest, token, isAuthenticated, setToken, clearToken } = useApiRequest()

// 多标签页同步监听（App.vue 启动时一次性注册）
let storageListenerRegistered = false

// 认证恢复标志，防止重复调用
let authRestored = false

/** 启动时恢复认证：无论本地有无 user，均以 Cookie 为权威调 /auth/me 校验 */
async function restoreAuth(): Promise<User | null> {
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

/** 多标签页同步：localStorage user 变化经 schema 校验后同步，失败视为登出 */
function handleStorageChange(event: StorageEvent): void {
  if (event.key === USER_STORAGE_KEY) {
    if (event.newValue === null) {
      // 他页登出：本页同步登出（store 重置由 App.vue watch(user) 驱动）
      user.value = null
      clearToken()
    } else {
      // 他页登录：本页同步
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

// store 重置由 App.vue watch(user) 驱动（user 变 null → 重置），不再用注册回调模式

/** 注册 storage 同步监听（仅执行一次，App.vue onMounted 调用） */
export function initAuthStorageListener(): void {
  if (storageListenerRegistered || typeof window === 'undefined') return
  storageListenerRegistered = true
  window.addEventListener('storage', handleStorageChange)
}

/** 解除 storage 监听（与注册配对，App.vue onUnmounted 调用） */
export function removeAuthStorageListener(): void {
  if (!storageListenerRegistered) return
  storageListenerRegistered = false
  window.removeEventListener('storage', handleStorageChange)
}

export function useAuth(): UseAuthReturn {
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
    // token 走 Cookie，同 login
    setToken('cookie-auth')
    user.value = data.user
    writeStoredUser(data.user)
    return data.user
  }

  /** 登出：调用后端接口清除 HttpOnly Cookie */
  async function logout(): Promise<void> {
    try {
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
