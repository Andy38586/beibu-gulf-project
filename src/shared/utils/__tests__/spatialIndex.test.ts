import { describe, it, expect, beforeEach } from 'vitest'
import { createSpatialIndex, VIEWPORT_CULL_THRESHOLD, type IndexedItem } from '../spatialIndex'

interface POI {
  id: number | string
}

/** 构造点要素索引项：点要素的 BBox 退化为单点 */
function makePointItem(x: number, y: number, data: POI): IndexedItem<POI> {
  return { minX: x, minY: y, maxX: x, maxY: y, data }
}

describe('createSpatialIndex', () => {
  let index: ReturnType<typeof createSpatialIndex>

  beforeEach(() => {
    index = createSpatialIndex()
  })

  it('load 应能批量加载要素到索引', () => {
    index.load([
      makePointItem(0, 0, { id: 1 }),
      makePointItem(10, 10, { id: 2 }),
      makePointItem(20, 20, { id: 3 }),
    ])
    expect(index.size()).toBe(3)
  })

  it('query 应能查询 BBox 范围内的要素', () => {
    index.load([
      makePointItem(0, 0, { id: 1 }),
      makePointItem(10, 10, { id: 2 }),
      makePointItem(20, 20, { id: 3 }),
    ])
    const result = index.query([5, 5, 15, 15])
    expect(result).toHaveLength(1)
    expect(result[0].data).toEqual({ id: 2 })
  })

  it('clear 应能清空索引', () => {
    index.load([makePointItem(0, 0, { id: 1 })])
    expect(index.size()).toBe(1)
    index.clear()
    expect(index.size()).toBe(0)
  })

  it('size 应返回索引项数量', () => {
    expect(index.size()).toBe(0)
    index.load([makePointItem(0, 0, { id: 1 }), makePointItem(1, 1, { id: 2 })])
    expect(index.size()).toBe(2)
  })
})

describe('边界情况', () => {
  let index: ReturnType<typeof createSpatialIndex>

  beforeEach(() => {
    index = createSpatialIndex()
    index.load([
      makePointItem(0, 0, { id: 'a' }),
      makePointItem(10, 10, { id: 'b' }),
      makePointItem(20, 20, { id: 'c' }),
      makePointItem(30, 30, { id: 'd' }),
    ])
  })

  it('空索引查询应返回空数组', () => {
    const empty = createSpatialIndex()
    expect(empty.query([-100, -100, 100, 100])).toEqual([])
  })

  it('查询不重叠的 BBox 应返回空数组', () => {
    expect(index.query([100, 100, 200, 200])).toEqual([])
  })

  it('查询完全包含的 BBox 应返回所有要素', () => {
    const result = index.query([-10, -10, 40, 40])
    expect(result).toHaveLength(4)
  })

  it('查询部分重叠的 BBox 应返回交集要素', () => {
    const result = index.query([5, 5, 25, 25])
    expect(result).toHaveLength(2)
    const ids = result.map((r) => (r.data as POI).id as string).sort()
    expect(ids).toEqual(['b', 'c'])
  })
})

describe('性能测试', () => {
  it('加载 10000 个随机点，查询视口内要素应在 50ms 内完成', () => {
    const index = createSpatialIndex<{ id: number }>()
    const items: IndexedItem<{ id: number }>[] = []
    for (let i = 0; i < 10000; i++) {
      const x = Math.random() * 1000
      const y = Math.random() * 1000
      items.push({ minX: x, minY: y, maxX: x, maxY: y, data: { id: i } })
    }
    index.load(items)

    const start = performance.now()
    const result = index.query([200, 200, 800, 800])
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(50)
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThan(10000)
  })
})

describe('VIEWPORT_CULL_THRESHOLD 常量', () => {
  it('值应为 1000', () => {
    expect(VIEWPORT_CULL_THRESHOLD).toBe(1000)
  })
})
