/**
 * 统一静态资源加载器（JSON/GeoJSON）：
 * 统一超时（默认 10s）+ 可选内存缓存（TTL=缓存有效期，默认 5min）+ in-flight 去重 +
 * 缓存上限（超过按 LRU=最近最少使用近似淘汰最旧插入项）。
 * 使用方：mapDataService、forecastAdapter/floodAdapter mock 分支。
 */
import type { ZodType } from 'zod'

import { logger } from '@/shared/utils/logger'

const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_CACHE_TTL = 5 * 60 * 1000
// 缓存硬上限，防止长会话内存膨胀
const MAX_CACHE_SIZE = 100

const cache = new Map<string, { data: unknown; cachedAt: number }>()
const pending = new Map<string, Promise<unknown>>()

export interface LoadStaticOptions<T = unknown> {
  /** 超时毫秒数，默认 10000 */
  timeout?: number
  /** 缓存 TTL（有效期）毫秒数，设为 0 禁用缓存，默认 5min */
  cacheTTL?: number
  /** 外部取消信号 */
  signal?: AbortSignal
  /** 可选 zod schema（运行时校验）：对 fetch 与缓存命中数据做 safeParse；缓存命中校验失败清缓存重拉，fetch 校验失败抛错 */
  schema?: ZodType<T>
}

/** 写入缓存前检查上限，超限删最旧插入项（Map 迭代序即插入序，近似 LRU 淘汰） */
function setCache(url: string, data: unknown): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
  cache.set(url, { data, cachedAt: Date.now() })
}

/** 加载静态 JSON（统一超时 + 可选缓存 + 并发去重） */
export async function loadStatic<T = unknown>(
  url: string,
  options: LoadStaticOptions<T> = {}
): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT_MS, cacheTTL = DEFAULT_CACHE_TTL, signal, schema } = options

  // 缓存命中
  if (cacheTTL > 0) {
    const hit = cache.get(url)
    if (hit && Date.now() - hit.cachedAt < cacheTTL) {
      // 缓存命中也走 schema 校验，失败清缓存重拉（可能为旧版本结构残留）
      if (schema) {
        const result = schema.safeParse(hit.data)
        if (result.success) {
          return result.data
        }
        logger.warn(`[loadStatic] 缓存数据校验失败，已清除缓存重新拉取: ${url}`)
        cache.delete(url)
      } else {
        return hit.data as T
      }
    }
  }

  // in-flight 去重：同一 URL 并发只发一次请求
  if (pending.has(url)) {
    return pending.get(url) as Promise<T>
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  // 组合外部 signal
  const combinedSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal

  const p = (async () => {
    try {
      const response = await fetch(url, { signal: combinedSignal })
      if (!response.ok) {
        throw new Error(`静态资源加载失败: ${url} (HTTP ${response.status})`)
      }
      const data = await response.json()
      // fetch 结果同样走 schema 校验，失败抛错拒绝消费不合规数据；缓存写入校验后的值
      if (schema) {
        const result = schema.safeParse(data)
        if (!result.success) {
          throw new Error(`静态资源数据格式校验失败: ${url}`)
        }
        if (cacheTTL > 0) {
          setCache(url, result.data)
        }
        return result.data
      }
      if (cacheTTL > 0) {
        setCache(url, data)
      }
      return data
    } finally {
      pending.delete(url)
      clearTimeout(timeoutId)
    }
  })()

  pending.set(url, p)
  return p as Promise<T>
}

/** 清除全部缓存 */
export function clearStaticCache(): void {
  cache.clear()
  pending.clear()
}

/** 清除指定 URL 的缓存 */
export function invalidateStatic(url: string): void {
  cache.delete(url)
}
