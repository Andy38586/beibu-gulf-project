// 深路径导入 @/core/config/map：走 @/core 入口会形成 core↔services 循环依赖（no-circular），此模块是叶子配置
import { MAP_CONFIG } from '@/core/config/map'
import { invalidateStatic, isInBeibuGulf, loadStatic, logger } from '@/shared'
import type { Port } from '@/types'
import { portsArraySchema } from '@/types/schemas'

// 港口数据为静态参考数据（与 boundary 同类，4166934b 曾收归后端，2026-08-29 回迁前端）：
// /data/ports.json 由前端托管（vite/nginx 直接服务），后端存活与否不影响港口图层与要素气泡。
// loadStatic 统一超时 + TTL 内存缓存 + in-flight 去重；zod schema 仍在数据边界把关（形状把关与来源无关）。
export const mapDataService = {
  async getPorts(signal?: AbortSignal): Promise<Port[]> {
    try {
      const ports = await loadStatic<Port[]>(MAP_CONFIG.DATA_PATHS.ports, {
        schema: portsArraySchema,
        signal,
      })

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
      if (error instanceof Error && error.message.includes('静态资源数据格式校验失败')) {
        logger.error('港口数据格式验证失败:', error)
        throw Object.assign(new Error('港口数据格式不正确，请联系管理员'), { cause: error })
      }
      logger.error('加载港口数据失败:', error)
      throw error
    }
  },

  clearCache(): void {
    invalidateStatic(MAP_CONFIG.DATA_PATHS.ports)
  },
}
