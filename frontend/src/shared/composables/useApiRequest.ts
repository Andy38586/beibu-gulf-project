import type { ComputedRef, Ref } from 'vue'
import { computed, ref } from 'vue'
import type { ZodType } from 'zod'

import { unwrapEnvelope } from '@/shared/utils/responseEnvelope'

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

interface RequestOptions<T = unknown> {
  method?: string
  body?: string
  headers?: Record<string, string>
  signal?: AbortSignal
  /** GET 查询参数，内部用 URLSearchParams 拼接（无需手写模板字符串） */
  params?: Record<string, string | number | boolean | undefined | null>
  /**
   * z045: 可选 zod schema，传入则对信封解包后的 data 做 safeParse 运行时校验，
   * 替代裸 `as T` 断言；不传入则保持 `as T` 行为（向后兼容）。
   * 校验失败抛 ApiError(REQUEST_FAILED)（不在重试码列表内，不会触发 z049 重试）。
   */
  schema?: ZodType<T>
}

export function useApiRequest() {
  // token 为模块级单例，由 setToken/clearToken 维护，不在每次调用时重新加载

  async function apiRequest<T = unknown>(
    path: string,
    options: RequestOptions<T> = {}
  ): Promise<T> {
    // z049: GET 幂等请求在超时/网络错误时线性退避重试（POST 不重试，避免重复写操作）
    const MAX_RETRIES = 3
    const RETRYABLE_CODES: ErrorCodeValue[] = [ErrorCode.TIMEOUT, ErrorCode.NETWORK_ERROR]
    const RETRY_DELAY_MS = 800

    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await _singleRequest<T>(path, options)
      } catch (error) {
        const isGet = (options.method ?? 'GET').toUpperCase() === 'GET'
        const code = error instanceof ApiError ? error.code : null
        const isRetryable = code !== null && RETRYABLE_CODES.includes(code)
        // 外部主动取消（options.signal 已 abort）→ 不重试
        const isExternalCancel =
          error instanceof ApiError && code === ErrorCode.REQUEST_FAILED && options.signal?.aborted
        if (!isGet || !isRetryable || isExternalCancel || attempt === MAX_RETRIES) {
          throw error
        }
        lastError = error
        // 线性退避：0.8s / 1.6s / 2.4s
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt))
      }
    }
    throw lastError
  }

  /**
   * z049: 单次请求实现（原 apiRequest 函数体整体抽出）。
   * 仅负责 headers/params/超时/fetch/信封解包/错误映射，不含重试逻辑；
   * 每次调用新建 AbortController，超时计时天然重置，支持重试。
   */
  async function _singleRequest<T = unknown>(path: string, options: RequestOptions<T>): Promise<T> {
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
       * 后端统一返回 { code, data }，此处经公共 unwrapEnvelope 提取 data 部分，
       * 调用方始终拿到业务数据 T，无需手动 .data（z063 抽出的唯一事实源）。
       */
      const unwrapped = unwrapEnvelope<T>(data)

      // z045: 若调用方传入 schema，用 safeParse 替代裸 `as T` 断言做运行时校验。
      // 校验失败抛 ApiError(REQUEST_FAILED)，不在 z049 重试码列表内（响应数据错误不可重试）。
      if (options.schema) {
        const result = options.schema.safeParse(unwrapped)
        if (!result.success) {
          throw new ApiError('响应数据格式校验失败', ErrorCode.REQUEST_FAILED)
        }
        return result.data
      }

      return unwrapped
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
