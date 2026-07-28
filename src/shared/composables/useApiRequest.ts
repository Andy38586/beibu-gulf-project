import { ref, computed } from 'vue'
import type { Ref, ComputedRef } from 'vue'

// 错误码：使用 as const 对象 + 联合类型，避免 enum 在 ESLint 下的成员误报
export const ErrorCode = {
  TIMEOUT: 'TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  SERVER_ERROR: 'SERVER_ERROR',
  REQUEST_FAILED: 'REQUEST_FAILED',
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

export class ApiError extends Error {
  code: ErrorCodeValue
  constructor(message: string, code: ErrorCodeValue) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

const token: Ref<string> = ref('')
const API_BASE: string = import.meta.env.VITE_API_BASE || '/api'
const API_TIMEOUT_MS: number = 10000

function setToken(t: string): void {
  // Token 仅写入内存，认证主通道是 HttpOnly Cookie
  token.value = t
}

function clearToken(): void {
  // 清内存 token，Cookie 由后端 clearCookie 清理
  token.value = ''
}

const isAuthenticated: ComputedRef<boolean> = computed(() => token.value !== '')

interface RequestOptions {
  method?: string
  body?: string
  headers?: Record<string, string>
  signal?: AbortSignal
}

export function useApiRequest() {
  // token 为模块级单例，由 setToken/clearToken 维护，不在每次调用时重新加载

  async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    // 认证统一通过 HttpOnly Cookie（credentials: 'include'），不发 Bearer header
    // token.value 仅用于前端判断 isAuthenticated，不参与请求传输

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS)

    // 如果外部传入 signal，使用 AbortSignal.any 组合
    const signal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        credentials: 'include',
        signal,
      })
      clearTimeout(timeoutId)

      // 响应体可能为空或非 JSON，分别处理避免错误信息丢失
      const text = await res.text()
      let data: Record<string, unknown> = {}
      if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          // JSON 解析失败时把原始文本作为 error 信息保留
          data = { error: text.slice(0, 200) }
        }
      }

      if (res.status === 401) {
        // 不在这里 clearToken/redirect：401 可能只是某个接口需要登录
        // 调用方自行决定是否提示登录（选址分析不需要，收藏才需要）
        throw new ApiError('请先登录', ErrorCode.UNAUTHORIZED)
      }

      if (!res.ok) {
        if (res.status === 500) {
          throw new ApiError(
            (data.error as string) || '服务器错误，请稍后重试',
            ErrorCode.SERVER_ERROR
          )
        }
        throw new ApiError(
          (data.error as string) || `请求失败 HTTP ${res.status}`,
          ErrorCode.REQUEST_FAILED
        )
      }

      return data as T
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof ApiError) {
        throw error
      }
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new ApiError('请求超时，请检查网络后重试', ErrorCode.TIMEOUT)
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
