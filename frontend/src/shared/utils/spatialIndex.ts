/**
 * 前端空间索引工具（基于 rbush）
 *
 * 与后端 server/utils/spatialIndex.js 对应，用于前端大数据量要素的视口裁剪。
 * 当 POI 数量超过阈值（默认 1000）时，构建 R-tree 索引，视口变化时只查询视口内要素，
 * 避免全量渲染导致的性能问题。
 *
 * 坐标系：索引使用 EPSG:3857（Web Mercator），与 OpenLayers view 一致
 */
import RBush from 'rbush'
import type { BBox } from 'rbush'

/** 触发视口裁剪的要素数量阈值 */
export const VIEWPORT_CULL_THRESHOLD = 1000

/** 索引项：BBox + 原始数据引用 */
export interface IndexedItem<T = unknown> extends BBox {
  data: T
}

/**
 * 空间索引封装
 * @example
 * ```ts
 * const index = createSpatialIndex<POI>()
 * index.load(pois.map(p => ({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y, data: p })))
 * const visible = index.query(viewExtent)
 * ```
 */
export function createSpatialIndex<T = unknown>() {
  const tree = new RBush<IndexedItem<T>>()

  /** 批量加载要素到索引 */
  function load(items: IndexedItem<T>[]): void {
    tree.load(items)
  }

  /**
   * 查询 BBox 范围内的所有要素
   * @param extent [minX, minY, maxX, maxY]，EPSG:3857
   */
  function query(extent: [number, number, number, number]): IndexedItem<T>[] {
    return tree.search({
      minX: extent[0],
      minY: extent[1],
      maxX: extent[2],
      maxY: extent[3],
    })
  }

  /** 清空索引 */
  function clear(): void {
    tree.clear()
  }

  /** 索引项数量 */
  function size(): number {
    return tree.all().length
  }

  return { load, query, clear, size }
}
