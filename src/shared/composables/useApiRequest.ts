import { ref, computed } from 'vue'
import type { Ref, ComputedRef } from 'vue'

/**
 * P3-002-FIX: 错误码枚举，替代字符串匹配
 * 用于统一错误处理，提高可维护性
 */
export enum ErrorCode {
  TIMEOUT = 'TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  SERVER_ERROR = 'SERVER_ERROR',
  REQUEST_FAILED = 'REQUEST_FAILED',
}

/**
 * 自定义API错误类，携带错误码
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const token: Ref<string> = ref('')
const API_BASE: string = import.meta.env.VITE_API_BASE || '/api'

function setToken(t: string): void {
  // AUDIT-SEC-001 修复：移除 localStorage 写入，Token 仅通过 HttpOnly Cookie 存储
  token.value = t
}

function clearToken(): void {
  // AUDIT-SEC-001 修复：移除 localStorage 清理，Cookie 由后端 clearCookie 清理
  token.value = ''
}

const isAuthenticated: ComputedRef<boolean> = computed(() => token.value !== '')

interface RequestOptions extends RequestInit {
  headers?: Record<string, string>
}

export function useApiRequest() {
  // AUDIT-SEC-001: Cookie 通道认证，token 仅由 setToken() 设置
  // 不再调用 loadToken()，避免每次调用时重置 token 状态

  // 泛型函数，支持调用方推导返回值类型
  async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    if (token.value !== '') {
      headers['Authorization'] = `Bearer ${token.value}`
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        credentials: 'include', // AUDIT-SEC-001 修复：自动携带 HttpOnly Cookie
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        clearToken()
        const router = (await import('@/router')).default
        if (router.currentRoute.value.path !== '/') {
          router.push('/')
        }
        throw new ApiError('登录已过期，请重新登录', ErrorCode.UNAUTHORIZED)
      }

      if (!res.ok) {
        if (res.status === 500) {
          throw new ApiError(data.error || '服务器错误，请稍后重试', ErrorCode.SERVER_ERROR)
        }
        throw new ApiError(data.error || `请求失败 HTTP ${res.status}`, ErrorCode.REQUEST_FAILED)
      }

      return data as T
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new ApiError('请求超时，请稍后重试', ErrorCode.TIMEOUT)
        }
        if (error instanceof TypeError && error.message.includes('fetch')) {
          throw new ApiError('网络异常，请检查网络连接', ErrorCode.NETWORK_ERROR)
        }
      }
      throw error
    }
  }

  return {
    apiRequest,
    token,
    isAuthenticated,
    setToken,
    clearToken,
  }
}
