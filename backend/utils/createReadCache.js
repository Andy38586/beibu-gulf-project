/**
 * createReadCache — 读文件缓存工厂：统一 TTL + LRU 近似淘汰（FIFO）+ 容量上限，
 * 收敛后端各处自研缓存实现。
 * get 命中且 TTL 有效返回 value，过期删除并返回 undefined（不自动重算，由调用方决定）；
 * set 超 maxSize 淘汰最旧插入项；不做访问刷新（读命中不挪序）。
 */
export function createReadCache({ maxSize = 100, ttlMs = 5 * 60 * 1000 } = {}) {
  /** @type {Map<string, { value: unknown, cachedAt: number }>} */
  const cache = new Map()

  function get(key) {
    const entry = cache.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.cachedAt > ttlMs) {
      cache.delete(key)
      return undefined
    }
    return entry.value
  }

  function set(key, value) {
    if (cache.size >= maxSize) {
      const oldestKey = cache.keys().next().value
      if (oldestKey !== undefined) cache.delete(oldestKey)
    }
    cache.set(key, { value, cachedAt: Date.now() })
  }

  function has(key) {
    return cache.has(key)
  }

  function clear() {
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
