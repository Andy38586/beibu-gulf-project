import { ref, onMounted, onUnmounted } from 'vue'
import type { Ref } from 'vue'
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

const user: Ref<User | null> = ref(readStoredUser())

// AUDIT-313-003: 多标签页状态同步标志
let storageListenerAttached = false

export function useAuth() {
  const { apiRequest, token, isAuthenticated, setToken, clearToken } = useApiRequest()

  /**
   * AUDIT-313-003: 处理 storage 事件，实现多标签页 token 同步
   * 当其他标签页登出或登录时，当前标签页自动同步状态
   */
  function handleStorageChange(event: StorageEvent): void {
    if (event.key === 'auth_token') {
      if (event.newValue === null) {
        // 其他标签页登出了，当前标签页也要登出
        user.value = null
        clearToken()
      } else if (event.newValue !== token.value) {
        // 其他标签页登录了，当前标签页也要同步
        // 注意：这里不能直接获取用户信息，需要重新调用 checkAuth
        checkAuth()
      }
    }
    
    if (event.key === USER_STORAGE_KEY) {
      if (event.newValue === null) {
        user.value = null
      } else {
        try {
          user.value = JSON.parse(event.newValue)
        } catch {
          user.value = null
        }
      }
    }
  }

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

  function logout(): void {
    clearToken()
    user.value = null
    writeStoredUser(null)
  }

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
      return null
    }
  }

  // AUDIT-313-003: 在组件挂载时添加 storage 事件监听
  onMounted(() => {
    if (!storageListenerAttached && typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorageChange)
      storageListenerAttached = true
    }
  })

  // AUDIT-313-003: 在组件卸载时移除 storage 事件监听
  onUnmounted(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorageChange)
      storageListenerAttached = false
    }
  })

  return { user, token, isAuthenticated, login, register, logout, checkAuth }
}
