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
 * 计算当前相机视口的经纬度范围（简化估算）
 * ⚠️ 注意：Cesium `camera.positionCartographic` 的 longitude/latitude 单位为**弧度**，
 * 必须用 CesiumMath.toDegrees 转换为角度后再与要素经纬度比较。
 * @param renderer CesiumRenderer 实例（访问 viewer）
 * @returns 视口范围；太高（>5000km）或无相机时返回 null（不裁剪）
 */
export function getViewportBBox(renderer: any): ViewportBBox | null {
  if (!renderer.viewer) return null
  const camera = renderer.viewer.camera
  const cartographic = camera.positionCartographic
  if (!cartographic) return null
  // 根据相机高度估算视口范围（简化版）
  // 高度越高，视口范围越大
  const height = cartographic.height
  if (height > 5000000) return null // 太高不做裁剪
  // 粗略估算：1 度 ≈ 111km，视口半宽 ≈ height / 2 / 111000 * 1.5（余量）
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
