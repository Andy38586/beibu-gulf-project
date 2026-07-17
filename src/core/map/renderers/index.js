import { MapRenderer } from './MapRenderer'
import { OLRenderer } from './OLRenderer'

export { MapRenderer, OLRenderer }

/**
 * 创建地图渲染器
 *
 * - 2D（OL）：静态导入，首屏即可用
 * - 3D（Cesium）：动态导入，仅进入 3D 路由时才加载，避免首屏加载 5MB+ 的 Cesium
 */
export async function createRenderer(type, container) {
  if (type === '2d') {
    return new OLRenderer(container)
  }
  // 按需加载 Cesium 渲染器（仅在切换到 3D 时触发）
  const { CesiumRenderer } = await import('./CesiumRenderer')
  return new CesiumRenderer(container)
}