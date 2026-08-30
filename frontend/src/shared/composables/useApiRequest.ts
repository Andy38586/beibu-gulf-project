import type { ComputedRef, Ref } from 'vue'
import { computed, ref } from 'vue'
import type { ZodType } from 'zod'

import { perfRecordApi } from '@/shared/utils/perfReporter'
import { unwrapEnvelope } from '@/shared/utils/responseEnvelope'

import { logger } from '../utils/logger'

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
  /** 后端业务码（响应信封 code 字段，如 401002=账号不存在 / 401003=密码错误），供调用方细粒度分支 */
  bizCode?: number
  constructor(message: string, code: ErrorCodeValue, bizCode?: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.bizCode = bizCode
  }
}

const token: Ref<string> = ref('')
const API_BASE: string = import.meta.env.VITE_API_BASE || '/api'
const API_TIMEOUT_MS: number = 10000

// 请求关联 ID 序列：每次 apiRequest 自增生成，日志显式携带（并发安全，不做全局设置）
let requestSeq = 0
function nextRequestId(): string {
  requestSeq += 1
  return `r${requestSeq}-${Date.now().toString(36)}`
}

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
  /**
   * 可选 zod schema（运行时校验）：传入则对解包后的 data 做 safeParse，替代裸 `as T` 断言；
   * 校验失败抛 ApiError(REQUEST_FAILED)，不可重试（响应数据错误重试无意义）。
   * 类型声明为 ZodType<unknown> 而非 ZodType<T>——schema 只负责运行时形状把关，
   * 业务类型仍由调用方 T 声明，宽松 schema 才不会与业务 interface 编译冲突。
   */
  schema?: ZodType<unknown>
  /** 是否解包响应信封（{ code, data } → data），默认 true；跨服务裸 JSON 调用传 false 跳过 */
  envelope?: boolean
}

/** 返回契约（816-专项3-0816-13：显式化，防重构时签名静默漂移） */
export interface UseApiRequestReturn {
  apiRequest: <T = unknown>(path: string, options?: RequestOptions) => Promise<T>
  token: Ref<string>
  isAuthenticated: ComputedRef<boolean>
  setToken: (t: string) => void
  clearToken: () => void
}

export function useApiRequest(): UseApiRequestReturn {
  // token 为模块级单例，由 setToken/clearToken 维护

  async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    // GET 幂等请求在超时/网络错误时线性退避重试（POST 不重试，避免重复写操作）
    const MAX_RETRIES = 3
    const RETRYABLE_CODES: ErrorCodeValue[] = [ErrorCode.TIMEOUT, ErrorCode.NETWORK_ERROR]
    const RETRY_DELAY_MS = 800
    // 请求关联 ID：贯穿重试/日志/错误（生产可排查）
    const rid = nextRequestId()

    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      // 接口耗时打点（按 path 分桶）
      const start = performance.now()
      try {
        return await _singleRequest<T>(path, options, rid)
      } catch (error) {
        const isGet = (options.method ?? 'GET').toUpperCase() === 'GET'
        const code = error instanceof ApiError ? error.code : null
        const isRetryable = code !== null && RETRYABLE_CODES.includes(code)
        // 外部主动取消（options.signal 已 abort）→ 不重试
        const isExternalCancel =
          error instanceof ApiError && code === ErrorCode.REQUEST_FAILED && options.signal?.aborted
        if (!isGet || !isRetryable || isExternalCancel || attempt === MAX_RETRIES) {
          // 失败采样日志（生产观测口）：重试耗尽/不可重试错误带请求 ID 输出
          logger.sampled(
            'info',
            `[apiRequest:${rid}] ✗ ${options.method ?? 'GET'} ${path} 失败(${attempt}/${MAX_RETRIES})`,
            error instanceof ApiError ? error.code : String(error)
          )
          throw error
        }
        lastError = error
        // 线性退避：0.8s / 1.6s（MAX_RETRIES=3，第三档 2.4s 因 attempt===MAX_RETRIES 已直接抛错而不可达；注释与实现已对齐）
        // 退避期间检查外部取消，避免卸载后仍延迟后重试
        if (options.signal?.aborted) throw error
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, RETRY_DELAY_MS * attempt)
          options.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(t)
              resolve()
            },
            { once: true }
          )
        })
        if (options.signal?.aborted) throw error
      } finally {
        perfRecordApi(path, performance.now() - start)
      }
    }
    throw lastError
  }

  /** 单次请求实现（不含重试）：每次调用新建 AbortController，超时计时天然重置 */
  async function _singleRequest<T = unknown>(
    path: string,
    options: RequestOptions,
    rid: string
  ): Promise<T> {
    // dev 请求日志：故障时定位数据在哪一跳丢失
    if (import.meta.env.DEV) {
      logger.debug(
        `[apiRequest:${rid}] → ${options.method ?? 'GET'} ${path}`,
        options.params ?? undefined
      )
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    // 认证走 HttpOnly Cookie（credentials: 'include'），token 仅用于前端登录态判断，不参与传输
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS)

    // 组合外部 signal 与内部超时 signal
    const signal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal

    // 统一 query 参数构造，避免手写模板字符串
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
      // 以 /flood-online 开头（vite proxy → FastAPI）的路径不加 /api 前缀：加了会命中 /api 规则转发到 Express，永远到不了 FastAPI
      // 以 /api 开头（如 auth/plans 等 REST 路径）视为已含前缀，不再叠加——
      // 曾因双重拼接打成 /api/api/ports → 404 → 港口图层加载失败（816-专项1 发现3 回归，2026-08-17 修复）
      const url =
        path.startsWith('/flood-online') || path.startsWith('/api/')
          ? fullPath
          : `${API_BASE}${fullPath}`
      const res = await fetch(url, {
        method: options.method,
        body: options.body,
        headers,
        credentials: 'include',
        signal,
        // 禁用浏览器缓存：Express 默认 ETag 返回 304，fetch 视其为错误（res.ok 只认 2xx）→ 误判登出/数据失败
        cache: 'no-store',
      })
      clearTimeout(timeoutId)

      // 响应体可能为空或非 JSON：用 unknown 承接任意 JSON 值，解析失败保留原始文本作错误信息
      const text = await res.text()
      let data: unknown = undefined
      if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          data = { error: text.slice(0, 200) }
        }
      }

      if (res.status === 401) {
        // 认证失败透传服务端文案；后端已细分登录失败成因（401002 账号不存在 / 401003 密码错误），
        // bizCode 随 ApiError 上抛供调用方细粒度分支（LoginPanel 据此引导注册/只报密码错误）
        const authErrMsg =
          typeof data === 'object' && data !== null && 'error' in data
            ? String((data as Record<string, unknown>).error)
            : ''
        const bizCode =
          typeof data === 'object' &&
          data !== null &&
          'code' in data &&
          typeof (data as Record<string, unknown>).code === 'number'
            ? ((data as Record<string, unknown>).code as number)
            : undefined
        // 401 只抛错不跳转：是否提示登录由调用方决定（选址分析不需要，收藏才需要）
        throw new ApiError(authErrMsg || '请先登录', ErrorCode.UNAUTHORIZED, bizCode)
      }

      if (!res.ok) {
        // 安全窄化：data 可能为非对象（如纯字符串/数字），用 typeof + in 守卫
        const errMsg =
          typeof data === 'object' && data !== null && 'error' in data
            ? String((data as Record<string, unknown>).error)
            : ''
        // 网关级 5xx（nginx 502/503/504）：后端进程不可达而非应用自身错误——
        // 归 SERVER_ERROR 语义，describeError 统一按「服务器无响应」口径提示
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          throw new ApiError('服务器无响应，请检查网络后重试', ErrorCode.SERVER_ERROR)
        }
        if (res.status === 500) {
          throw new ApiError(errMsg || '服务器错误，请稍后重试', ErrorCode.SERVER_ERROR)
        }
        throw new ApiError(errMsg || `请求失败 HTTP ${res.status}`, ErrorCode.REQUEST_FAILED)
      }

      // 统一解包响应信封（{ code, data } → data）：调用方始终拿到业务数据 T，无需手动 .data；跨服务裸 JSON 传 envelope: false 跳过
      let unwrapped: T
      if (options.envelope === false) {
        unwrapped = data as T
      } else {
        // D2：code 契约 = 同 HTTP 状态（后端 sendSuccess code=statusCode 恒 2xx）——
        // HTTP 2xx 但 code≥400 的业务错误信封显式失败，杜绝「错误数据被当成功解包」静默放大
        const code =
          typeof data === 'object' && data !== null && 'code' in data
            ? (data as Record<string, unknown>).code
            : undefined
        if (typeof code === 'number' && code >= 400) {
          throw new ApiError(`响应业务错误（code=${code}）`, ErrorCode.REQUEST_FAILED)
        }
        unwrapped = unwrapEnvelope<T>(data)
      }

      // dev 响应日志
      if (import.meta.env.DEV) {
        logger.debug(`[apiRequest:${rid}] ← ${res.status} ${path}`, {
          envelope: options.envelope === false ? 'raw' : 'envelope',
          schema: options.schema ? 'zod' : 'none',
        })
      } else {
        // 生产采样观测：dev 全量日志被门控剥离后，成功路径也需可观测入口
        logger.sampled('info', `[apiRequest:${rid}] ← ${res.status} ${path}`)
      }

      // 有 schema 则运行时校验；校验失败不可重试（响应数据错误重试无意义）
      if (options.schema) {
        const result = options.schema.safeParse(unwrapped)
        if (!result.success) {
          // 映射/校验失败生产可观测：记录校验问题概览（不展开字段，防敏感/噪音）
          logger.sampled(
            'warn',
            `[apiRequest:${rid}] schema 校验失败 ${path}:`,
            result.error.issues.slice(0, 3).map((i) => i.path.join('.'))
          )
          throw new ApiError('响应数据格式校验失败', ErrorCode.REQUEST_FAILED)
        }
        return result.data as T
      }

      return unwrapped
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof ApiError) {
        throw error
      }
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          // 区分内部超时 abort 与外部 signal 主动取消：内部超时抛 TIMEOUT
          if (controller.signal.aborted) {
            throw new ApiError('请求超时，请检查网络后重试', ErrorCode.TIMEOUT)
          }
          // 外部主动取消：抛 REQUEST_FAILED（多数调用方已忽略此错误）
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
