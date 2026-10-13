import type { Ref } from 'vue'
import { ref } from 'vue'
import type { ZodType } from 'zod'

import { combineSignals } from '@/shared/utils/abortSignal'
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

type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

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
/**
 * 后端基址（**单前缀**）。
 *
 * 2026-10-12（D1a 收口）：原为「双前缀 + 逐模块开关」——`VITE_USE_NEST_MODULES` 列出已迁 Nest
 * 的域走 `/nest-api`，其余回落 `/api`（Express 旧前缀）。Express 退役后那一侧不再有独立实现，
 * 且两个环境里分支归宿并不一致（实测）：
 *   · dev：`vite.config.js` 的 `/api` 代理**无 rewrite** ⇒ 原样转给 Nest，而 Nest 全局前缀是
 *     `nest-api` ⇒ 落到 `/api` 就是 **404**（即开关在 dev 是承重的，清单漏一域即 404）；
 *   · 生产：nginx 的 `/api` location **有** `rewrite → /nest-api` ⇒ 与 `/nest-api` 同一服务。
 * 即该开关改的只是 URL 前缀、不是后端实现。迁移期已过，故收口为单前缀；
 * `VITE_USE_NEST_MODULES`、域清单 `MODULE_BY_PATH_PREFIX`、逐域解析、路由日志一并删除
 * （判据对象的消失见 routes-audit 的同步退役说明）。
 */
const NEST_API_BASE: string = import.meta.env.VITE_NEST_API_BASE || '/nest-api'
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

// 认证态判据 isAuthenticated 已上移 useAuth（token+user 双判据，审查 M-10/M-9）——
// 此处仅 token 不够判定登录态，勿再在此重建第二份判据

/**
 * 信封字段安全窄化：响应体可能是任意 JSON（纯字符串/数字等非对象），统一在此守卫取
 * `error`（string，缺省空串）与 `code`（number | undefined）。考古 P2：401 分支、
 * 非 401 错误分支、信封解包守卫三处同构提取原为复制粘贴，收口一处防漂移。
 */
function readEnvelopeFields(data: unknown): { error: string; code: number | undefined } {
  if (typeof data !== 'object' || data === null) return { error: '', code: undefined }
  const rec = data as Record<string, unknown>
  return {
    error: 'error' in rec ? String(rec.error) : '',
    code: typeof rec.code === 'number' ? rec.code : undefined,
  }
}

export interface RequestOptions {
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
  /**
   * 单次请求超时（ms），缺省 API_TIMEOUT_MS（10s）。慢查询端点（如 route 寻路，
   * 生产实测单次可达 26s）显式放宽；每次重试的计时独立重置。
   */
  timeoutMs?: number
  /**
   * GET 遇超时/网络错误是否重试（默认 true）。慢查询端点传 false——超时后重试
   * 等于把「单次超时 × 3」的等待与服务端负载再放大一遍（route 域曾因此雪上加霜）。
   */
  retry?: boolean
}

/** 返回契约（显式化，防重构时签名静默漂移） */
interface UseApiRequestReturn {
  apiRequest: <T = unknown>(path: string, options?: RequestOptions) => Promise<T>
  token: Ref<string>
  setToken: (t: string) => void
  clearToken: () => void
}

/** 单次请求实现（不含重试）：每次调用新建 AbortController，超时计时天然重置。
 *  模块级纯函数（只依赖参数与模块常量），可脱离工厂独立单测请求全链路 */
async function singleRequest<T = unknown>(
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
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? API_TIMEOUT_MS)

  // 组合外部 signal 与内部超时 signal
  // 2026-09-10：原用 AbortSignal.any（Chrome116/Safari17.4+），与 browserslist 声明的
  // Safari>=14.1 冲突且 vite 不 polyfill 运行时 API → 低版本浏览器传 signal 即 TypeError。
  const combined = combineSignals([controller.signal, options.signal])
  const signal = combined.signal

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
    // 以 /api、/nest-api 开头（如 auth/plans 等 REST 路径）视为已含前缀，不再叠加——
    // 曾因双重拼接打成 /api/api/ports → 404 → 港口图层加载失败（ 回归，2026-08-17 修复）
    // 其余路径一律按单前缀 NEST_API_BASE 拼接（D1a 收口后已无逐功能域分支）
    // 2026-09-10（阶段 4）：原 /flood-online 前缀分支已随 FastAPI 退役移除
    const url =
      path.startsWith('/api/') || path.startsWith('/nest-api/')
        ? fullPath
        : `${NEST_API_BASE}${fullPath}`
    const res = await fetch(url, {
      method: options.method,
      body: options.body,
      headers,
      credentials: 'include',
      signal,
      // 禁用浏览器缓存：后端默认 ETag 返回 304，fetch 视其为错误（res.ok 只认 2xx）→ 误判登出/数据失败
      cache: 'no-store',
    })

    // 响应体可能为空或非 JSON：用 unknown 承接任意 JSON 值，解析失败保留原始文本作错误信息
    const text = await res.text()
    // 超时定时器必须覆盖到 body 读取完成：fetch 已返回、body 传输卡住时（大 GeoJSON
    // 数 MB 最高发），若此刻已清定时器则 abort 永不触发 → 请求永久挂起（审查 M-7）
    clearTimeout(timeoutId)
    // 1004-05：settle 后摘除外源监听（原先只在 abort 路径摘，正常完成每次残留一个闭包）
    combined.dispose()
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
      const { error: authErrMsg, code: bizCode } = readEnvelopeFields(data)
      // 401 只抛错不跳转：是否提示登录由调用方决定（选址分析不需要，收藏才需要）
      throw new ApiError(authErrMsg || '请先登录', ErrorCode.UNAUTHORIZED, bizCode)
    }

    if (!res.ok) {
      // 安全窄化收口到 readEnvelopeFields（data 可能为纯字符串/数字等非对象）
      const { error: errMsg, code: bizCode } = readEnvelopeFields(data)
      // 🔴 业务码（响应信封 code）必须一并上抛。taskStore 靠 `bizCode === 404001`
      // 区分「任务已被 TTL 回收 = 正常结束，停轮询不弹错」与「真的取不到」。
      // 此前只有 401 分支传了第三参，下面三处恒抛 undefined ⇒ 那条判定永不成立，
      // 回收任务被连计 5 次后误报「服务繁忙/任务超时」（04-D1 吞错误对象 + 04-B1）。
      // 网关级 5xx（nginx 502/503/504）：后端进程不可达而非应用自身错误——
      // 归 SERVER_ERROR 语义，describeError 统一按「服务器无响应」口径提示
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new ApiError('服务器无响应，请检查网络后重试', ErrorCode.SERVER_ERROR, bizCode)
      }
      if (res.status === 500) {
        throw new ApiError(errMsg || '服务器错误，请稍后重试', ErrorCode.SERVER_ERROR, bizCode)
      }
      throw new ApiError(errMsg || `请求失败 HTTP ${res.status}`, ErrorCode.REQUEST_FAILED, bizCode)
    }

    // 统一解包响应信封（{ code, data } → data）：调用方始终拿到业务数据 T，无需手动 .data。
    // D2：code 契约 = 同 HTTP 状态（后端 sendSuccess code=statusCode 恒 2xx）——
    // HTTP 2xx 但 code≥400 的业务错误信封显式失败，杜绝「错误数据被当成功解包」静默放大
    const { code } = readEnvelopeFields(data)
    if (code !== undefined && code >= 400) {
      throw new ApiError(`响应业务错误（code=${code}）`, ErrorCode.REQUEST_FAILED)
    }
    const unwrapped: T = unwrapEnvelope<T>(data)

    // dev 响应日志
    if (import.meta.env.DEV) {
      logger.debug(`[apiRequest:${rid}] ← ${res.status} ${path}`, {
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
        // 字段路径随错误透出（前 3 条），调用方排障不再盲猜（审查 L-10）
        const issuePaths = result.error.issues
          .slice(0, 3)
          .map((i) => i.path.join('.') || '(root)')
          .join('、')
        throw new ApiError(`响应数据格式校验失败：${issuePaths}`, ErrorCode.REQUEST_FAILED)
      }
      return result.data as T
    }

    return unwrapped
  } catch (error) {
    clearTimeout(timeoutId)
    combined.dispose()
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
      // TypeError 一律归网络异常：JSON.parse 的解析错误已在上方内层 catch 吞掉、
      // 信封/校验路径均有形状守卫，此处能到达的 TypeError 实际只来自 fetch 阶段。
      // 不做错误文案匹配——各运行时文案不一致（"Failed to fetch"/"NetworkError" 等），
      // 按 message.includes('fetch') 匹配会把网络错误漏成"未知错误"绕过 ApiError 体系（审查 M-8）
      if (error instanceof TypeError) {
        throw new ApiError('网络异常，请检查网络连接', ErrorCode.NETWORK_ERROR)
      }
    }
    throw error
  }
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
        return await singleRequest<T>(path, options, rid)
      } catch (error) {
        const isGet = (options.method ?? 'GET').toUpperCase() === 'GET'
        const code = error instanceof ApiError ? error.code : null
        // retry:false 的端点（慢查询）不重试：超时后再来一次等于双倍服务端负载与等待
        const isRetryable =
          code !== null && RETRYABLE_CODES.includes(code) && options.retry !== false
        // 外部主动取消（options.signal 已 abort）→ 不重试
        const isExternalCancel =
          error instanceof ApiError && code === ErrorCode.REQUEST_FAILED && options.signal?.aborted
        if (!isGet || !isRetryable || isExternalCancel || attempt === MAX_RETRIES) {
          // 失败日志（生产观测口）：重试耗尽/不可重试错误带请求 ID 输出。
          // F8：级别改 warn——logger.sampled 对 warn 不做采样（失败不得被 1% 吞掉）
          logger.sampled(
            'warn',
            `[apiRequest:${rid}] ✗ ${options.method ?? 'GET'} ${path} 失败(${attempt}/${MAX_RETRIES})`,
            error instanceof ApiError ? error.code : String(error)
          )
          throw error
        }
        lastError = error
        // 线性退避：0.8s / 1.6s（MAX_RETRIES=3，第三档 2.4s 因 attempt===MAX_RETRIES 已直接抛错而不可达；注释与实现已对齐）
        // 退避期间检查外部取消，避免卸载后仍延迟后重试
        if (options.signal?.aborted) throw error
        // abort listener 必须在等待结束后摘除：once 只防重复触发，
        // 未触发的残留会随每次重试在外部 signal 上累积（审查 L-9）
        const signal = options.signal
        let onAbort: (() => void) | null = null
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, RETRY_DELAY_MS * attempt)
          if (signal) {
            onAbort = () => {
              clearTimeout(t)
              resolve()
            }
            signal.addEventListener('abort', onAbort, { once: true })
          }
        }).finally(() => {
          if (signal && onAbort) signal.removeEventListener('abort', onAbort)
        })
        if (options.signal?.aborted) throw error
      } finally {
        perfRecordApi(path, performance.now() - start)
      }
    }
    throw lastError
  }

  return {
    apiRequest,
    token,
    setToken,
    clearToken,
  }
}
