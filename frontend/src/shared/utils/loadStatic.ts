/**
 * 统一静态资源加载器
 *
 * 收口前端各处裸 fetch 静态 JSON/GeoJSON 的行为：
 * - 统一超时（默认 10s）
 * - 可选内存缓存（TTL 5min）
 * - in-flight Promise 去重（同一 URL 并发只发一次请求）
 * - 缓存大小上限（z050-FE）：超过 MAX_CACHE_SIZE 时按 LRU 近似淘汰最旧插入项
 *
 * 使用方：mapDataService、forecastAdapter mock 分支、floodAdapter mock 分支。
 */

const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_CACHE_TTL = 5 * 60 * 1000
// z050-FE: 缓存硬上限，防止长会话内存膨胀
const MAX_CACHE_SIZE = 100

const cache = new Map<string, { data: unknown; cachedAt: number }>()
const pending = new Map<string, Promise<unknown>>()

export interface LoadStaticOptions {
  /** 超时毫秒数，默认 10000 */
  timeout?: number
  /** 缓存 TTL 毫秒数，设为 0 禁用缓存，默认 5min */
  cacheTTL?: number
  /** 外部取消信号 */
  signal?: AbortSignal
}

/**
 * z050-FE: 写入缓存前检查上限，超限删除最旧插入项（Map 迭代序即插入序，
 * keys().next().value 即最旧键，近似 LRU 淘汰）。
 */
function setCache(url: string, data: unknown): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
  cache.set(url, { data, cachedAt: Date.now() })
}

/**
 * 加载静态 JSON 资源（统一超时 + 可选缓存 + 去重）
 * @param url - 资源路径（如 '/data/ports.json'）
 * @param options - 加载选项
 * @returns 解析后的 JSON 数据
 */
export async function loadStatic<T = unknown>(
  url: string,
  options: LoadStaticOptions = {}
): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT_MS, cacheTTL = DEFAULT_CACHE_TTL, signal } = options

  // 缓存命中
  if (cacheTTL > 0) {
    const hit = cache.get(url)
    if (hit && Date.now() - hit.cachedAt < cacheTTL) {
      return hit.data as T
    }
  }

  // in-flight 去重
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
