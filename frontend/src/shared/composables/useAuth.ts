import type { Ref } from 'vue'
import { ref } from 'vue'

import { logger } from '@/shared/utils/logger'
import { useFloodState } from '@/stores/floodState'
import { useMapStore } from '@/stores/mapStore'
import { usePortImpactStore } from '@/stores/portImpactStore'
import { useProfileStore } from '@/stores/profileStore'
// 登出时重置全部业务 store，防止跨账号数据残留
import { useSiteSelectionStateStore } from '@/stores/siteSelectionState'
import { useWaterLevelStore } from '@/stores/waterLevelStore'
import type { AuthResponse, User } from '@/types/api'

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

// 模块级别单例状态，确保所有组件共享同一状态
const user: Ref<User | null> = ref(readStoredUser())
const { apiRequest, token, isAuthenticated, setToken, clearToken } = useApiRequest()

// 多标签页状态同步 - 全局单例监听（由 App.vue 启动时一次性注册）
let storageListenerRegistered = false

// 认证恢复标志，防止重复调用
let authRestored = false

// 将 checkAuth 提升到模块级别，供 handleStorageChange 调用
async function checkAuth(): Promise<User | null> {
  // 使用显式布尔转换
  if (token.value === '') return null
  try {
    const data = await apiRequest<{ user: User }>('/auth/me')
    // 空值检查
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
    const data = await apiRequest<{ user: User }>('/auth/me')
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
 */
function handleStorageChange(event: StorageEvent): void {
  if (event.key === USER_STORAGE_KEY) {
    if (event.newValue === null) {
      // 其他标签页登出了，当前标签页也要登出
      user.value = null
      clearToken()
      resetBusinessStores()
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

// 登出时重置全部业务 store，防止跨账号数据残留
function resetBusinessStores(): void {
  try {
    useSiteSelectionStateStore().clearState()
    useFloodState().clearState()
    usePortImpactStore().resetPortImpact()
    useWaterLevelStore().resetWaterLevel()
    useProfileStore().resetProfile()
    // b035+b043: 重置地图业务交互状态，清 analysisHandler 闭包与 sessionStorage
    useMapStore().resetMapState()
  } catch {
    // store 未激活等异常不阻断登出
  }
}

/**
 * 注册多标签页 storage 同步监听（仅执行一次）
 * 应在 App.vue onMounted 中调用，无需组件上下文，不会抛错
 */
export function initAuthStorageListener(): void {
  if (storageListenerRegistered || typeof window === 'undefined') return
  storageListenerRegistered = true
  window.addEventListener('storage', handleStorageChange)
}

export function useAuth() {
  async function login(username: string, password: string): Promise<User> {
    const data = await apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    if (!data || !data.user) {
      throw new Error('登录响应数据无效')
    }
    // d038: token 由 HttpOnly Cookie 携带，前端仅设占位符启用 isAuthenticated
    setToken('cookie-auth')
    user.value = data.user
    writeStoredUser(data.user)
    return data.user
  }

  async function register(username: string, password: string): Promise<User> {
    const data = await apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    if (!data || !data.user) {
      throw new Error('注册响应数据无效')
    }
    // d038: 同 login，token 走 Cookie
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
      // 清理前端状态
      clearToken()
      user.value = null
      writeStoredUser(null)
      // 重置认证恢复标志，允许下次重新恢复
      authRestored = false
      resetBusinessStores()
    }
  }

  return { user, token, isAuthenticated, login, register, logout, checkAuth, restoreAuth }
}
