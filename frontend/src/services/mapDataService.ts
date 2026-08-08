// 收口例外：MAP_CONFIG 走深路径 @/core/config/map 而非 @/core。
// 原因：core/index.ts re-export usePortLayer → usePortLayer 依赖 @/services → services/index.ts
// re-export mapDataService → 若 mapDataService 再走 @/core 会形成 core↔services 循环依赖（no-circular）。
// @/core/config/map 是无反向依赖的叶子配置模块，直接 import 安全。
import { MAP_CONFIG } from '@/core/config/map'
import { clearStaticCache, loadStatic } from '@/shared'
import { logger } from '@/shared'
import { unwrapEnvelope } from '@/shared'
import type { Port } from '@/types'
import { isInBeibuGulf } from '@/shared'

/**
 * 静态资源 fetch 收口 loadStatic。
 * loadStatic 已内置：10s 超时、5min TTL 内存缓存、in-flight Promise 去重，
 * 与原 mapDataService 自建的 controller/timeoutId/dataCache/pendingCache 行为等价。
 * 行为差异：loadStatic 缓存原始 JSON（解包前），此处返回前再 unwrapEnvelope，
 * 对调用方等价（unwrapEnvelope 是纯函数，开销极小）。
 */
async function fetchData(url: string): Promise<unknown> {
  const raw = await loadStatic<unknown>(url)
  return unwrapEnvelope(raw)
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

  clearCache(): void {
    // 委托 loadStatic 的 clearStaticCache 清统一缓存
    clearStaticCache()
  },
}
