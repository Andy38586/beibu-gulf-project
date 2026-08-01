import type { ComputedRef, Ref } from 'vue'
import { computed, ref } from 'vue'

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
  /** GET 查询参数，内部用 URLSearchParams 拼接（无需手写模板字符串） */
  params?: Record<string, string | number | boolean | undefined | null>
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

    // P2-1: 统一 query 参数构造，避免手写模板字符串
    let fullPath = path
    if (options.params) {
      const searchParams = new URLSearchParams()
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined && value !== null) {
          searchParams.set(key, String(value))
        }
      }
      const qs = searchParams.toString()
      if (qs) {
        fullPath += `${path.includes('?') ? '&' : '?'}${qs}`
      }
    }

    try {
      const res = await fetch(`${API_BASE}${fullPath}`, {
        method: options.method,
        body: options.body,
        headers,
        credentials: 'include',
        signal,
      })
      clearTimeout(timeoutId)

      // 响应体可能为空或非 JSON，分别处理避免错误信息丢失
      // data 用 unknown 而非 Record<string, unknown>，因为 JSON.parse 可返回任意 JSON 值
      const text = await res.text()
      let data: unknown = undefined
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
        // 安全窄化：data 可能为非对象（如纯字符串/数字），用 typeof + in 守卫
        const errMsg =
          typeof data === 'object' && data !== null && 'error' in data
            ? String((data as Record<string, unknown>).error)
            : ''
        if (res.status === 500) {
          throw new ApiError(errMsg || '服务器错误，请稍后重试', ErrorCode.SERVER_ERROR)
        }
        throw new ApiError(errMsg || `请求失败 HTTP ${res.status}`, ErrorCode.REQUEST_FAILED)
      }

      /**
       * P1-1 响应契约收口：自动解包信封式响应。
       * 后端统一返回 { code, data }，此处自动提取 data 部分，
       * 调用方始终拿到业务数据 T，无需手动 .data。
       */
      if (
        typeof data === 'object' &&
        data !== null &&
        'code' in data &&
        'data' in (data as Record<string, unknown>)
      ) {
        return (data as Record<string, unknown>).data as T
      }
      return data as T
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof ApiError) {
        throw error
      }
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          // @arch-note SEC-021: 区分内部超时 abort vs 外部 signal 主动取消
          // controller 由本函数内部的 setTimeout 触发 abort → 超时
          // options.signal 由调用方主动 abort → 取消（非错误，不提示"超时"）
          if (controller.signal.aborted) {
            throw new ApiError('请求超时，请检查网络后重试', ErrorCode.TIMEOUT)
          }
          // 外部取消：抛 REQUEST_FAILED 供调用方按需处理（多数调用方已忽略此错误）
          throw new ApiError('请求已取消', ErrorCode.REQUEST_FAILED)
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
