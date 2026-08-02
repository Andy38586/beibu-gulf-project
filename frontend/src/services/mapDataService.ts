import type { FeatureCollection } from 'geojson'

import { MAP_CONFIG } from '@/core/config/map'
import { logger } from '@/shared/utils/logger'
import type { Port } from '@/types'
import { isInBeibuGulf } from '@/types/crs'

// 缓存加 TTL + in-flight Promise 去重
const CACHE_TTL = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 10000
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
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  // 先占位 pendingCache，再启动 fetch，消除"fetch 启动到 set 之间"的竞态窗口
  const p = (async () => {
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`请求失败: ${url}, HTTP ${response.status}`)
      }
      const raw = await response.json()
      // @arch-note P1-1: 统一信封解包（{ code, data } → data），与 useApiRequest 契约一致。
      // mapDataService 用原生 fetch（保留 TTL 缓存/去重/超时），此前不解包 → getPorts
      // 收到 {code,data} 对象 → Array.isArray 失败 → 港口+行政区划都不显示（z033 根修）。
      // REQ-1（阶段2）: 去掉 `Object.keys(raw).length === 2` 约束，与 useApiRequest
      // 基准契约（仅要求含 code+data）对齐。后端响应若带 message/timestamp 等扩展字段，
      // 此前解包失败 → getPorts 收到对象 → Array.isArray 失败 → 港口不显示（F-3）。
      const data =
        raw && typeof raw === 'object' && 'code' in raw && 'data' in raw
          ? (raw as Record<string, unknown>).data
          : raw
      dataCache.set(url, { data, cachedAt: Date.now() })
      return data
    } finally {
      pendingCache.delete(url)
      clearTimeout(timeoutId)
    }
  })()

  pendingCache.set(url, p)
  return p
}

interface CacheStatus {
  ports: boolean
  boundary: boolean
}

export const mapDataService = {
  async getPorts(): Promise<Port[]> {
    try {
      const data = await fetchData(MAP_CONFIG.DATA_PATHS.ports)
      if (!Array.isArray(data)) {
        throw new Error(`港口数据格式异常：期望数组类型，实际收到 ${typeof data}`)
      }
      const ports = data as Port[]

      // 6.4 CRS 边界守卫接入数据入口：过滤明显越界的异常坐标，防止污染地图渲染
      const inRegion: Port[] = []
      const outOfRegion: Port[] = []
      for (const p of ports) {
        ;(isInBeibuGulf({ lng: p.lng, lat: p.lat }) ? inRegion : outOfRegion).push(p)
      }
      if (outOfRegion.length > 0) {
        logger.debug('[crs] 已过滤越界港口坐标（北部湾边界外，疑似数据异常）:', outOfRegion)
      }
      return inRegion
    } catch (error) {
      if (error instanceof Error && error.message.includes('格式异常')) {
        logger.error('港口数据格式验证失败:', error)
        throw Object.assign(new Error('港口数据格式不正确，请联系管理员'), { cause: error })
      }
      logger.error('加载港口数据失败:', error)
      throw error
    }
  },

  // @audit-note DAT-4 预留未接入：当前边界加载由 useBoundaryLayer 承担，本方法保留作备用，请勿删除
  async getBoundary(): Promise<FeatureCollection> {
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
          logger.debug(`边界数据第${index}个feature结构无效:`, f)
          return false
        }
        return true
      })
      if (validFeatures.length === 0) {
        throw new Error('边界数据中无有效的feature')
      }
      return { ...data, features: validFeatures } as FeatureCollection
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('格式') || error.message.includes('feature'))
      ) {
        logger.error('边界数据格式验证失败:', error)
        throw Object.assign(new Error('边界数据格式不正确，请联系管理员'), { cause: error })
      }
      logger.error('加载边界数据失败:', error)
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
