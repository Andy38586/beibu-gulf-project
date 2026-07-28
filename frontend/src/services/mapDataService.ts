import { MAP_CONFIG } from '@/core/config/map'

// 缓存加 TTL + in-flight Promise 去重
const CACHE_TTL = 5 * 60 * 1000
const dataCache = new Map<string, { data: unknown; cachedAt: number }>()
const pendingCache = new Map<string, Promise<unknown>>()

async function fetchData(url: string): Promise<unknown> {
  const hit = dataCache.get(url)
  if (hit && Date.now() - hit.cachedAt < CACHE_TTL) {
    return hit.data
  }
  if (pendingCache.has(url)) {
    return pendingCache.get(url)!
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  const p = fetch(url, { signal: controller.signal })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`请求失败: ${url}, HTTP ${response.status}`)
      }
      return response.json()
    })
    .then((data) => {
      dataCache.set(url, { data, cachedAt: Date.now() })
      pendingCache.delete(url)
      return data
    })
    .catch((err) => {
      pendingCache.delete(url)
      throw err
    })
    .finally(() => clearTimeout(timeoutId))

  pendingCache.set(url, p)
  return p
}

interface CacheStatus {
  ports: boolean
  boundary: boolean
}

export const mapDataService = {
  async getPorts(): Promise<unknown> {
    try {
      const data = await fetchData(MAP_CONFIG.DATA_PATHS.ports)
      if (!Array.isArray(data)) {
        throw new Error(`港口数据格式异常：期望数组类型，实际收到 ${typeof data}`)
      }
      return data
    } catch (error) {
      if (error instanceof Error && error.message.includes('格式异常')) {
        console.error('港口数据格式验证失败:', error)
        throw Object.assign(new Error('港口数据格式不正确，请联系管理员'), { cause: error })
      }
      console.error('加载港口数据失败:', error)
      throw error
    }
  },

  async getBoundary(): Promise<unknown> {
    try {
      const data = (await fetchData(MAP_CONFIG.DATA_PATHS.boundary)) as Record<
        string,
        unknown
      > | null
      if (!data || typeof data !== 'object') {
        throw new Error('边界数据为空或格式无效')
      }
      const features = data.features
      if (!features || !Array.isArray(features)) {
        throw new Error('边界数据缺少features数组或格式不正确')
      }
      const validFeatures = features.filter((f: Record<string, unknown> | null, index: number) => {
        if (!f || !f.geometry || !(f.geometry as Record<string, unknown>).coordinates) {
          if (import.meta.env.DEV) {
            console.warn(`边界数据第${index}个feature结构无效:`, f)
          }
          return false
        }
        return true
      })
      if (validFeatures.length === 0) {
        throw new Error('边界数据中无有效的feature')
      }
      return { ...data, features: validFeatures }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('格式') || error.message.includes('feature'))
      ) {
        console.error('边界数据格式验证失败:', error)
        throw Object.assign(new Error('边界数据格式不正确，请联系管理员'), { cause: error })
      }
      console.error('加载边界数据失败:', error)
      throw error
    }
  },

  clearCache(): void {
    dataCache.clear()
    pendingCache.clear()
  },

  getCacheStatus(): CacheStatus {
    return {
      ports: dataCache.has(MAP_CONFIG.DATA_PATHS.ports),
      boundary: dataCache.has(MAP_CONFIG.DATA_PATHS.boundary),
    }
  },
}
