/**
 * createReadCache — 统一只读缓存工厂（数据流收口②）
 *
 * 背景：后端曾存在 4 套自研读缓存实现——
 *   - repositories/facilities.js、repositories/ports.js（自研 Map + TTL，无上限无 LRU）
 *   - services/forecastService.js engineCache（TTL + LRU）
 *   - controllers/floodAnalysisController.js _readCache（TTL + LRU）
 * 同一件事四种写法，新增仓库时"缓存该抄谁的"无据可依。
 * 本工厂统一 TTL + LRU 近似淘汰 + 容量上限，四调用方全部接入。
 *
 * 语义（与既有实现行为逐字等价，避免回归）：
 * - get(key)：命中且 TTL 有效返回 value；过期则删除并返回 undefined（不自动重算，
 *   由调用方决定重算/重读——保持 forecast/flood 现有"过期重算"语义）
 * - set(key, value)：超 maxSize 淘汰最旧插入项（Map 迭代序即插入序，keys().next() 最旧）
 * - 不做访问刷新（保持与现状一致：LRU 近似为 FIFO，读命中不挪序）
 *
 * @param {object} [opts]
 * @param {number} [opts.maxSize=100] 容量上限,超限淘汰最旧
 * @param {number} [opts.ttlMs=300000] 条目 TTL(ms)
 * @returns {{ get: (k: string) => unknown|undefined, set: (k: string, v: unknown) => void,
 *            has: (k: string) => boolean, clear: () => void, size: number }}
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
