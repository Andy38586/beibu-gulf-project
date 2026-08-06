/**
 * CesiumWaterSurface — Cesium 3D 水面 Primitive 管理
 * 拆分：从 CesiumRenderer.ts 纯搬移，逻辑零变化。
 * 使用 Primitive API（适合大规模几何体），通过重建 Primitive 实现水位更新。
 * 水面状态存储在 renderer._waterSurfaces（Map<id, {primitive, height, coordinates, options, visible}>）。
 *
 * 2026-08-06 增量更新（D-7）：updateWaterLevel 不再 remove+add 重建 Primitive——
 * 重建会让旧几何销毁、新几何异步构建，中间有空窗 → 水位拖动时水面"一闪一闪"。
 * 改为：复用同一 Primitive，仅替换 geometryInstances（同步构建新几何并赋值，
 * Cesium 在下一帧用新几何重绘），Primitive 对象、可见性、颜色缓冲全部复用。
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

import { LAYER_DEFAULTS } from '@/shared'
import { logger } from '@/shared'

/** 水面状态条目 */
interface WaterSurfaceEntry {
  primitive: Primitive
  height: number
  coordinates: [number, number][]
  options: Record<string, unknown>
  visible: boolean
}

/**
 * 构建水面 GeometryInstance（供 create 与 update 复用，避免重复代码）
 */
function buildWaterInstance(
  coordinates: [number, number][],
  height: number,
  options: Record<string, unknown>
): GeometryInstance {
  const positions = coordinates.map((coord) => Cartesian3.fromDegrees(coord[0], coord[1], height))
  const hierarchy = new PolygonHierarchy(positions)
  const geometry = new PolygonGeometry({
    polygonHierarchy: hierarchy,
    vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
  })

  return new GeometryInstance({
    geometry: geometry,
    attributes: {
      color: ColorGeometryInstanceAttribute.fromColor(
        // 水面色复用 LAYER_DEFAULTS.color（#409eff），保留 0.5 透明度以维持水面半透明观感
        Color.fromCssColorString((options.color as string) || LAYER_DEFAULTS.color).withAlpha(0.5)
      ),
    },
    id: `water-${height}`,
  })
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
    const instance = buildWaterInstance(coordinates, height, options)

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
 * 更新水位高度（增量更新，D-7 2026-08-06）
 * 复用同一 Primitive，仅替换 geometryInstances（同步构建新几何）：
 * - 不 remove/add → 无空窗 → 水位拖动不再"一闪一闪"
 * - 不重建 Primitive → 保留 GPU 缓冲复用路径，减少 GC/状态清理
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

  // 高度未变化 → 跳过（滑块拖动可能触发同值更新）
  if (waterSurface.height === newHeight) return

  try {
    // 同步构建新几何并替换到同一 Primitive（不销毁旧 Primitive）
    // Cesium 类型将 geometryInstances 标为只读，但运行时支持替换（增量更新依赖此行为，
    // 06908b5 引入时未跑 typecheck 的遗留错误）——用断言绕过类型只读标注
    ;(waterSurface.primitive as { geometryInstances: unknown }).geometryInstances =
      buildWaterInstance(waterSurface.coordinates, newHeight, waterSurface.options)
    waterSurface.height = newHeight
    renderer.viewer.scene.requestRender()
  } catch (e) {
    // 构建失败保持旧水位（不闪、不崩），仅日志
    if (import.meta.env.DEV) {
      logger.warn(`[CesiumRenderer] 水面 ${id} 水位更新失败（保持旧水位）:`, e)
    }
  }
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
