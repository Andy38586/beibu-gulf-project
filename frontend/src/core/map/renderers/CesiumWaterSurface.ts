/**
 * CesiumWaterSurface — Cesium 3D 水面 Primitive 管理
 *
 * z058 拆分：从 CesiumRenderer.ts 纯搬移，逻辑零变化。
 * 使用 Primitive API（适合大规模几何体），通过重建 Primitive 实现水位更新。
 *
 * 水面状态存储在 renderer._waterSurfaces（Map<id, {primitive, height, coordinates, options, visible}>）。
 */
import {
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  Primitive,
} from 'cesium'

import { LAYER_DEFAULTS } from '@/shared/constants/colors'
import { logger } from '@/shared/utils/logger'

/** 水面状态条目 */
interface WaterSurfaceEntry {
  primitive: Primitive
  height: number
  coordinates: [number, number][]
  options: Record<string, unknown>
  visible: boolean
}

/**
 * 添加水面 Primitive
 * @param renderer CesiumRenderer 实例（访问 viewer / _waterSurfaces）
 */
export function addWaterSurface(
  renderer: any,
  id: string,
  coordinates: [number, number][],
  height = 0,
  options: Record<string, unknown> = {}
): void {
  removeWaterSurface(renderer, id)
  try {
    const positions = coordinates.map((coord) => Cartesian3.fromDegrees(coord[0], coord[1], height))
    const hierarchy = new PolygonHierarchy(positions)
    const geometry = new PolygonGeometry({
      polygonHierarchy: hierarchy,
      vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
    })

    const instance = new GeometryInstance({
      geometry: geometry,
      attributes: {
        color: ColorGeometryInstanceAttribute.fromColor(
          // 水面色复用 LAYER_DEFAULTS.color（#409eff），保留 0.5 透明度以维持水面半透明观感
          Color.fromCssColorString((options.color as string) || LAYER_DEFAULTS.color).withAlpha(0.5)
        ),
      },
      id: `water-${id}`,
    })

    const appearance = new PerInstanceColorAppearance({
      translucent: true,
      closed: false,
    })

    const primitive = new Primitive({
      geometryInstances: instance,
      appearance: appearance,
      asynchronous: false,
    })

    renderer.viewer.scene.primitives.add(primitive)

    // 保存水面状态供后续更新使用
    renderer._waterSurfaces = renderer._waterSurfaces || new Map()
    renderer._waterSurfaces.set(id, {
      primitive: primitive,
      height: height,
      coordinates: coordinates,
      options: options,
      visible: true,
    })

    renderer.viewer.scene.requestRender()
  } catch (e) {
    // 坐标无效或几何体构建失败时不中断调用方
    if (import.meta.env.DEV) {
      logger.warn(`[CesiumRenderer] 水面图层 ${id} 创建失败:`, e)
    }
  }
}

/**
 * 更新水位高度
 *
 * 通过重建 Primitive 实现水位更新。
 * 保留原始坐标和样式选项，仅改变高度。
 *
 * @param renderer CesiumRenderer 实例
 * @param id 水面图层ID
 * @param newHeight 新的高度（米）
 */
export function updateWaterLevel(renderer: any, id: string, newHeight: number): void {
  const waterSurface: WaterSurfaceEntry | undefined = renderer._waterSurfaces?.get(id)
  if (!waterSurface) {
    if (import.meta.env.DEV) {
      logger.warn(`水面图层 ${id} 不存在，无法更新水位`)
    }
    return
  }

  // 用新高度重建水面
  addWaterSurface(renderer, id, waterSurface.coordinates, newHeight, waterSurface.options)
}

/**
 * 移除水面 Primitive
 * @param renderer CesiumRenderer 实例
 * @param id 水面图层ID
 */
export function removeWaterSurface(renderer: any, id: string): void {
  const waterSurface: WaterSurfaceEntry | undefined = renderer._waterSurfaces?.get(id)
  if (waterSurface) {
    renderer.viewer.scene.primitives.remove(waterSurface.primitive)
    renderer._waterSurfaces.delete(id)
    renderer.viewer.scene.requestRender()
  }
}

/**
 * 移除所有水面
 * @param renderer CesiumRenderer 实例
 */
export function removeAllWaterSurfaces(renderer: any): void {
  if (renderer._waterSurfaces) {
    renderer._waterSurfaces.forEach((_: WaterSurfaceEntry, id: string) =>
      removeWaterSurface(renderer, id)
    )
  }
}

/**
 * 设置水面可见性
 * @param renderer CesiumRenderer 实例
 * @param id 水面图层ID
 * @param visible 是否可见
 */
export function setWaterSurfaceVisibility(renderer: any, id: string, visible: boolean): void {
  const waterSurface: WaterSurfaceEntry | undefined = renderer._waterSurfaces?.get(id)
  if (waterSurface) {
    waterSurface.visible = visible
    waterSurface.primitive.show = visible
    renderer.viewer.scene.requestRender()
  }
}
