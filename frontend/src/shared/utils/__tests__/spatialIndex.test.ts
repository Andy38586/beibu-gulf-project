import { beforeEach, describe, expect, it } from 'vitest'

import { createSpatialIndex, type IndexedItem, VIEWPORT_CULL_THRESHOLD } from '../spatialIndex'

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

describe('万级要素的查询正确性（确定性数据集）', () => {
  // 线性同态伪随机（种子固定）：Math.random 使数据集每次不同 ⇒ 断言只能写
  // "结果大于 0"这类恒真式；墙钟 toBeLessThan(50) 则是随机器浮动的噪声
  // （慢 CI 假红、快机器假绿）。改为对**结果集合**敏感：期望集由同一份
  // 确定性数据线性过滤算出，索引用例与期望集逐项相等——索引建错即红。
  function lcg(seed: number): () => number {
    let s = seed
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296
      return s / 4294967296
    }
  }

  const COUNT = 10_000
  const rand = lcg(20260922)
  const items: IndexedItem<POI>[] = []
  for (let i = 0; i < COUNT; i++) {
    const x = rand() * 1000
    const y = rand() * 1000
    items.push(makePointItem(x, y, { id: i }))
  }

  function expectedInBox(box: [number, number, number, number]): number[] {
    return items
      .filter(
        (it) => it.minX >= box[0] && it.minY >= box[1] && it.maxX <= box[2] && it.maxY <= box[3]
      )
      .map((it) => (it.data as POI).id as number)
      .sort((a, b) => a - b)
  }

  it('load 万级要素后 query 视口返回精确交集（不多不少）', () => {
    const index = createSpatialIndex<POI>()
    index.load(items)
    expect(index.size()).toBe(COUNT)

    const box: [number, number, number, number] = [200, 200, 800, 800]
    const result = index.query(box)
    const got = result.map((r) => (r.data as POI).id as number).sort((a, b) => a - b)
    expect(got).toEqual(expectedInBox(box))
    // 视口只是全域的一部分（防"全量返回也相等"的退化通过）
    expect(got.length).toBeGreaterThan(0)
    expect(got.length).toBeLessThan(COUNT)
  })

  it('query 边带与空视口行为确定', () => {
    const index = createSpatialIndex<POI>()
    index.load(items)
    // 空视口（全域外）
    expect(index.query([2000, 2000, 3000, 3000])).toEqual([])
    // 全域视口 = 全量
    expect(index.query([-1, -1, 1001, 1001])).toHaveLength(COUNT)
  })
})

describe('VIEWPORT_CULL_THRESHOLD 常量', () => {
  it('值应为 1000', () => {
    expect(VIEWPORT_CULL_THRESHOLD).toBe(1000)
  })
})
