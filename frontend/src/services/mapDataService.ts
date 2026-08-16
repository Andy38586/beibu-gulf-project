// 深路径导入 @/core/config/map：走 @/core 入口会形成 core↔services 循环依赖（no-circular），此模块是叶子配置
import { MAP_CONFIG } from '@/core/config/map'
import { logger } from '@/shared'
import { useApiRequest } from '@/shared'
import { portsArraySchema } from '@/types/schemas'
import type { Port } from '@/types'
import { isInBeibuGulf } from '@/shared'

// 816-专项1 发现3：/api/ports 是 API 端点，统一走 useApiRequest（02 R1 明文——
// 原 loadStatic 缺重试/401 处理，报错口径与其它 API 不一致）。
// 注：模块级调用 useApiRequest 与专项2 1-3 同源反模式（其实现无生命周期依赖、可工作），
// 随 b040（authStore 收口）一并迁移至实例级。
const { apiRequest } = useApiRequest()

/**
 * 港口数据服务：API 统一入口 + zod 校验 + 北部湾边界守卫。
 * apiRequest 已内置超时/重试/信封解包/401 处理，schema 在 HTTP 边界把关。
 */
export const mapDataService = {
  async getPorts(): Promise<Port[]> {
    try {
      // schema 校验失败抛 ApiError(REQUEST_FAILED)（C-4/6 契约：/api/ports 为 HTTP 边界）
      const ports = await apiRequest<Port[]>(MAP_CONFIG.DATA_PATHS.ports, {
        schema: portsArraySchema,
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
      if (error instanceof Error && error.message.includes('响应数据格式校验失败')) {
        logger.error('港口数据格式验证失败:', error)
        throw Object.assign(new Error('港口数据格式不正确，请联系管理员'), { cause: error })
      }
      logger.error('加载港口数据失败:', error)
      throw error
    }
  },

  clearCache(): void {
    // apiRequest 为无状态请求（no-store），无前端缓存可清；保留兼容接口（原 loadStatic TTL 缓存已弃用）
  },
}
