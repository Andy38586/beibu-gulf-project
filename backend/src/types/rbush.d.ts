// rbush 3.0.1 最小类型声明：Express 侧为 JS 直用（传递依赖 @turf/geojson-rbush 拉入 3.0.1），
// nest 为 TS 需要声明；仅声明本项目实际消费的 API 面（load/search/all），不引 @types 包
//（依赖红线：不新增 npm 依赖）。
declare module 'rbush' {
  export interface BBox {
    minX: number
    minY: number
    maxX: number
    maxY: number
  }

  export default class RBush<T extends BBox> {
    constructor(maxEntries?: number)
    load(items: T[]): RBush<T>
    insert(item: T): RBush<T>
    search(bbox: BBox): T[]
    all(): T[]
  }
}
