import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import type { User, AuthResponse } from '@/types/api'
import { useApiRequest } from './useApiRequest'

/** localStorage 键：持久化用户信息 */
const USER_STORAGE_KEY = 'beibu-gulf-user'

/**
 * 从 localStorage 读取用户信息
 */
function readStoredUser(): User | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(USER_STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
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

// AUDIT-004 (架构): 模块级别单例状态，确保所有组件共享同一状态
const user: Ref<User | null> = ref(readStoredUser())
const { apiRequest, token, isAuthenticated, setToken, clearToken } = useApiRequest()

// AUDIT-313-003: 多标签页状态同步 - 引用计数和全局处理函数
let storageListenerCount = 0

// P1-002-FIX: 认证恢复标志，防止重复调用
let authRestored = false
let authRestorePromise: Promise<User | null> | null = null

// AUDIT-004: 将 checkAuth 提升到模块级别，供 handleStorageChange 调用
async function checkAuth(): Promise<User | null> {
  // AUDIT-022: 使用显式布尔转换
  if (token.value === '') return null
  try {
    const data = await apiRequest<{ user: User }>('/auth/me')
    // AUDIT-007: 空值检查
    if (!data || !data.user) {
      throw new Error('认证响应数据无效')
    }
    user.value = data.user
    return data.user
  } catch {
    clearToken()
    user.value = null
    writeStoredUser(null)
    return null
  }
}

/**
 * P1-002-FIX: 应用启动时恢复认证状态
 * 通过调用 /api/auth/me 验证 Cookie 中的 Token 是否有效
 */
async function restoreAuth(): Promise<User | null> {
  // 防止重复调用
  if (authRestored) {
    return user.value
  }

  // 如果已有用户信息（从 localStorage 恢复），尝试验证 Token
  if (user.value) {
    try {
      const data = await apiRequest<{ user: User }>('/auth/me')
      if (data && data.user) {
        user.value = data.user
        // Token 验证成功，设置一个占位 token 以启用 isAuthenticated
        setToken('restored-from-cookie')
        authRestored = true
        return data.user
      }
    } catch {
      // Token 无效，清除用户信息
      clearToken()
      user.value = null
      writeStoredUser(null)
    }
  }

  authRestored = true
  return null
}

/**
 * P2-001-FIX: 多标签页同步 - 监听 beibu-gulf-user 变化
 */
function handleStorageChange(event: StorageEvent): void {
  if (event.key === USER_STORAGE_KEY) {
    if (event.newValue === null) {
      // 其他标签页登出了，当前标签页也要登出
      user.value = null
      clearToken()
    } else {
      // 其他标签页登录了，当前标签页也要同步
      try {
        user.value = JSON.parse(event.newValue)
      } catch {
        user.value = null
      }
    }
  }
}

export function useAuth() {
  async function login(username: string, password: string): Promise<User> {
    const data = await apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    // AUDIT-005: 空值检查
    if (!data || !data.token || !data.user) {
      throw new Error('登录响应数据无效')
    }
    setToken(data.token)
    user.value = data.user
    writeStoredUser(data.user)
    return data.user
  }

  async function register(username: string, password: string): Promise<User> {
    const data = await apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    // AUDIT-006: 空值检查
    if (!data || !data.token || !data.user) {
      throw new Error('注册响应数据无效')
    }
    setToken(data.token)
    user.value = data.user
    writeStoredUser(data.user)
    return data.user
  }

  /**
   * P2-002-FIX: 登出时调用后端API清除Cookie
   */
  async function logout(): Promise<void> {
    try {
      // 调用后端登出接口，清除HttpOnly Cookie
      await apiRequest('/auth/logout', { method: 'POST' })
    } catch (error) {
      // 即使后端调用失败，也清理前端状态
      if (import.meta.env.DEV) {
        console.warn('登出接口调用失败，但仍清理前端状态:', error)
      }
    } finally {
      // 清理前端状态
      clearToken()
      user.value = null
      writeStoredUser(null)
      // 重置认证恢复标志，允许下次重新恢复
      authRestored = false
    }
  }

  // AUDIT-313-003: 在组件挂载时添加 storage 事件监听（引用计数）
  onMounted(() => {
    if (typeof window !== 'undefined' && storageListenerCount === 0) {
      window.addEventListener('storage', handleStorageChange)
    }
    storageListenerCount++
  })

  // AUDIT-313-003: 在组件卸载时移除 storage 事件监听（引用计数）
  onUnmounted(() => {
    storageListenerCount--
    if (typeof window !== 'undefined' && storageListenerCount === 0) {
      window.removeEventListener('storage', handleStorageChange)
    }
  })

  return { user, token, isAuthenticated, login, register, logout, checkAuth, restoreAuth }
}
