// 深路径导入 @/core/config/map：走 @/core 入口会形成 core↔services 循环依赖（no-circular），此模块是叶子配置
import { MAP_CONFIG } from '@/core/config/map'
import { clearStaticCache, loadStatic } from '@/shared'
import { logger } from '@/shared'
import { unwrapEnvelope } from '@/shared'
import type { Port } from '@/types'
import { isInBeibuGulf } from '@/shared'

/**
 * 静态资源 fetch 收口 loadStatic（内置超时、TTL 缓存、in-flight 去重），
 * 返回前解包 envelope（接口响应信封 {code,data}；unwrapEnvelope 是纯函数，开销极小）。
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

      // 边界守卫：过滤北部湾范围外的异常港口坐标，防止污染地图渲染
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
    // 委托 loadStatic 清统一缓存
    clearStaticCache()
  },
}
