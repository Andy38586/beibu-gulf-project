/**
 * 前端空间索引（rbush，EPSG:3857 Web Mercator，与 OpenLayers view 一致）：
 * POI 超阈值（默认 1000）时构建 R-tree，视口变化只查询视口内要素，避免全量渲染。
 * 与后端同名文件不同义（后端为多边形覆盖查询），勿相互引用或混用。
 */
import type { BBox } from 'rbush'
import RBush from 'rbush'

/** 触发视口裁剪的要素数量阈值 */
export const VIEWPORT_CULL_THRESHOLD = 1000

/** 索引项：BBox + 原始数据引用 */
export interface IndexedItem<T = unknown> extends BBox {
  data: T
}

/** 空间索引封装（load 批量加载，query 传入视口 extent 即得可见要素） */
export function createSpatialIndex<T = unknown>() {
  const tree = new RBush<IndexedItem<T>>()

  /** 批量加载要素到索引 */
  function load(items: IndexedItem<T>[]): void {
    tree.load(items)
  }

  /** 查询 BBox（[minX, minY, maxX, maxY]，EPSG:3857）内所有要素 */
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
