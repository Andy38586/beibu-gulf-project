import type { FeatureCollection } from 'geojson'

import { MAP_CONFIG } from '@/core/config/map'
import { clearStaticCache, loadStatic } from '@/shared/utils/loadStatic'
import { logger } from '@/shared/utils/logger'
import { unwrapEnvelope } from '@/shared/utils/responseEnvelope'
import type { Port } from '@/types'
import { isInBeibuGulf } from '@/types/crs'

/**
 * z032: 静态资源 fetch 收口 loadStatic。
 *
 * loadStatic 已内置：10s 超时、5min TTL 内存缓存、in-flight Promise 去重，
 * 与原 mapDataService 自建的 controller/timeoutId/dataCache/pendingCache 行为等价。
 * 行为差异：loadStatic 缓存原始 JSON（解包前），此处返回前再 unwrapEnvelope，
 * 对调用方等价（unwrapEnvelope 是纯函数，开销极小）。
 */
async function fetchData(url: string): Promise<unknown> {
  const raw = await loadStatic<unknown>(url)
  return unwrapEnvelope(raw)
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
    // z032: 委托 loadStatic 的 clearStaticCache 清统一缓存
    clearStaticCache()
  },

  getCacheStatus(): CacheStatus {
    // z032: loadStatic 未导出 cache 引用，缓存命中判断退化为"始终 false"，
    // 仅作占位（无生产调用方依赖此方法，可后续按需补 invalidateStatic 查询接口）
    return {
      ports: false,
      boundary: false,
    }
  },
}
