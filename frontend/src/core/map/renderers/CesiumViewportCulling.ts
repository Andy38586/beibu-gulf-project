/**
 * CesiumViewportCulling — Cesium 3D 视口裁剪
 * 拆分：从 CesiumRenderer.ts 纯搬移，逻辑零变化。
 * 负责视口范围估算、点要素视口裁剪、相机移动时的增量更新。
 * 裁剪状态存储在 renderer._layers 的图层条目上：
 * - layer.allFeatures：原始全量要素（供视口变化时增量更新）
 * - layer.cameraListener：相机变化监听器（requestAnimationFrame 防抖）
 */
import { Math as CesiumMath } from 'cesium'

/** 视口经纬度范围 */
export interface ViewportBBox {
  west: number
  east: number
  south: number
  north: number
}

/**
 * 计算当前相机视口的经纬度范围
 * ⚠️ 注意：Cesium `camera.positionCartographic` 的 longitude/latitude 单位为**弧度**，
 * 必须用 CesiumMath.toDegrees 转换为角度后再与要素经纬度比较。
 *
 * a019: 优先用 camera.computeViewRectangle(scene.globe) 取**真实视口四角投影**
 * 覆盖范围——替代原圆形/方形估算（原 `halfRange = (height/111000)*1.5` 在
 * pitch≠-90 倾斜视角下会把视口边缘 POI 错误裁剪）。computeViewRectangle 不可用
 * （场景未渲染/globe 缺失）时回退原估算。
 *
 * @param renderer CesiumRenderer 实例（访问 viewer）
 * @returns 视口范围；太高（>5000km）或无相机时返回 null（不裁剪）
 */
export function getViewportBBox(renderer: any): ViewportBBox | null {
  if (!renderer.viewer) return null
  const camera = renderer.viewer.camera
  const scene = renderer.viewer.scene
  const cartographic = camera.positionCartographic
  if (!cartographic) return null
  const height = cartographic.height
  if (height > 5000000) return null // 太高不做裁剪

  // a019: 真实视口四角投影（倾斜视角下边缘 POI 不再误裁）
  try {
    const rect = camera.computeViewRectangle(scene?.globe)
    if (rect) {
      return {
        west: CesiumMath.toDegrees(rect.west),
        east: CesiumMath.toDegrees(rect.east),
        south: CesiumMath.toDegrees(rect.south),
        north: CesiumMath.toDegrees(rect.north),
      }
    }
  } catch {
    // computeViewRectangle 在场景未渲染等场景可能抛错——回退下方估算
  }

  // 兜底：相机高度圆形估算（原逻辑,仅真实投影不可用时的近似）
  const halfRange = Math.min((height / 111000) * 1.5, 10) // 上限 10 度
  const centerLon = CesiumMath.toDegrees(cartographic.longitude)
  const centerLat = CesiumMath.toDegrees(cartographic.latitude)
  return {
    west: centerLon - halfRange,
    east: centerLon + halfRange,
    south: centerLat - halfRange,
    north: centerLat + halfRange,
  }
}

/**
 * 判断点是否在当前视口内
 * @param lng 经度
 * @param lat 纬度
 * @param bbox 视口范围（null 时不裁剪，返回 true）
 */
export function isInViewport(lng: number, lat: number, bbox: ViewportBBox | null): boolean {
  if (!bbox) return true // 无视口信息时不裁剪
  return lng >= bbox.west && lng <= bbox.east && lat >= bbox.south && lat <= bbox.north
}

/**
 * 为点图层注册视口变化监听
 * 相机移动时，增量添加/移除视口内外的要素（requestAnimationFrame 防抖）
 * @param renderer CesiumRenderer 实例
 * @param id 图层ID
 */
export function setupViewportListener(renderer: any, id: string): void {
  const layer = renderer._layers.get(id)
  if (!layer || !layer.allFeatures) return

  // 防抖：相机移动时频繁触发，用 requestAnimationFrame 合并
  let rafId: number | null = null
  const updateHandler = () => {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => {
      updateCulledLayer(renderer, id)
      rafId = null
    })
  }

  // 移除旧监听（如果存在）
  if (layer.cameraListener) {
    renderer.viewer.camera.changed.removeEventListener(layer.cameraListener)
  }

  renderer.viewer.camera.changed.addEventListener(updateHandler)
  layer.cameraListener = updateHandler
}

/**
 * 视口变化时增量更新裁剪图层：移除离开视口的 Entity，添加新进入视口的 Entity
 * @param renderer CesiumRenderer 实例（访问 _layers / viewer / _createCesiumPointEntity）
 * @param id 图层ID
 */
export function updateCulledLayer(renderer: any, id: string): void {
  const layer = renderer._layers.get(id)
  if (!layer || !layer.allFeatures || !layer.visible) return

  const bbox = getViewportBBox(renderer)
  if (!bbox) return

  // 计算应显示的要素 ID 集合（ID 与 _createCesiumPointEntity 保持一致：id-name-index）
  const shouldShow = new Set<string>()
  layer.allFeatures.forEach((item: any, index: number) => {
    const lng = item.lng ?? item.lon ?? 0
    if (isInViewport(lng, item.lat, bbox)) {
      shouldShow.add(`${id}-${item.id || item.name || 'p'}-${index}`)
    }
  })

  // 移除不在视口内的 Entity
  for (const entity of layer.instance) {
    if (!shouldShow.has(entity.id)) {
      renderer.viewer.entities.remove(entity)
    }
  }

  // 添加新进入视口的 Entity
  const existingIds = new Set<string>(layer.instance.map((e: any) => e.id))
  layer.allFeatures.forEach((item: any, index: number) => {
    const entityId = `${id}-${item.id || item.name || 'p'}-${index}`
    if (shouldShow.has(entityId) && !existingIds.has(entityId)) {
      const entity = renderer._createCesiumPointEntity(id, item, index, layer.options)
      if (entity) layer.instance.push(entity)
    }
  })

  // 清理已移除的 Entity 引用
  layer.instance = layer.instance.filter((e: any) => renderer.viewer.entities.contains(e))
}
