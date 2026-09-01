// 读缓存工厂：对齐老 Express createReadCache（TTL + LRU 近似淘汰 FIFO + 容量上限）。
// get 命中且 TTL 有效返回 value，过期删除并返回 undefined（不自动重算，调用方决定）；
// set 超 maxSize 淘汰最旧插入项；不做访问刷新（读命中不挪序）。
export interface ReadCache<T> {
  get(key: string): T | undefined
  set(key: string, value: T): void
  has(key: string): boolean
  clear(): void
  readonly size: number
}

export function createReadCache<T>({ maxSize = 100, ttlMs = 5 * 60 * 1000 } = {}): ReadCache<T> {
  const cache = new Map<string, { value: T; cachedAt: number }>()

  function get(key: string): T | undefined {
    const entry = cache.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.cachedAt > ttlMs) {
      cache.delete(key)
      return undefined
    }
    return entry.value
  }

  function set(key: string, value: T): void {
    if (cache.size >= maxSize) {
      const oldestKey = cache.keys().next().value
      if (oldestKey !== undefined) cache.delete(oldestKey)
    }
    cache.set(key, { value, cachedAt: Date.now() })
  }

  function has(key: string): boolean {
    // has 与 get 的 TTL 语义对齐：过期条目删除并返回 false，
    // 避免 has() 为 true 而 get() 返回 undefined 的矛盾窗口
    const entry = cache.get(key)
    if (!entry) return false
    if (Date.now() - entry.cachedAt > ttlMs) {
      cache.delete(key)
      return false
    }
    return true
  }

  function clear(): void {
    cache.clear()
  }

  return {
    get,
    set,
    has,
    clear,
    get size() {
      return cache.size
    },
  }
}
