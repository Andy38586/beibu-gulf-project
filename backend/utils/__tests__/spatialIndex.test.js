import { booleanPointInPolygon, point } from '@turf/turf'
import { describe, expect,it } from 'vitest'

import { createSpatialIndex, queryByPolygon } from '../spatialIndex.js'

describe('Spatial Index (R-tree)', () => {
  describe('createSpatialIndex', () => {
    it('should create index from xiaoqu data', () => {
      const xiaoquData = [
        { id: 1, name: '小区A', lng: 108.3, lat: 22.8 },
        { id: 2, name: '小区B', lng: 108.4, lat: 22.9 },
        { id: 3, name: '小区C', lng: 108.5, lat: 23.0 },
      ]
      const tree = createSpatialIndex(xiaoquData)
      expect(tree).toBeDefined()
      expect(typeof tree.search).toBe('function')
    })

    it('should handle empty data', () => {
      const tree = createSpatialIndex([])
      expect(tree).toBeDefined()
      expect(
        queryByPolygon(tree, {
          geometry: {
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1],
                [0, 0],
              ],
            ],
          },
        })
      ).toEqual([])
    })
  })

  describe('queryByPolygon', () => {
    it('should return points inside polygon bounding box', () => {
      const xiaoquData = [
        { id: 1, name: '内部小区', lng: 108.4, lat: 22.9 },
        { id: 2, name: '边界小区', lng: 108.35, lat: 22.85 },
        { id: 3, name: '外部小区', lng: 108.1, lat: 22.6 },
        { id: 4, name: '外部小区2', lng: 108.6, lat: 23.1 },
      ]
      const tree = createSpatialIndex(xiaoquData)

      const polygon = {
        geometry: {
          coordinates: [
            [
              [108.3, 22.8],
              [108.5, 22.8],
              [108.5, 23.0],
              [108.3, 23.0],
              [108.3, 22.8],
            ],
          ],
        },
      }

      const result = queryByPolygon(tree, polygon)
      const resultIds = result.map((xq) => xq.id)

      expect(resultIds).toContain(1)
      expect(resultIds).toContain(2)
      expect(resultIds).not.toContain(3)
      expect(resultIds).not.toContain(4)
    })

    it('should filter out points outside bounding box', () => {
      const xiaoquData = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `小区${i + 1}`,
        lng: 108.0 + (i % 10) * 0.1,
        lat: 22.0 + Math.floor(i / 10) * 0.1,
      }))
      const tree = createSpatialIndex(xiaoquData)

      const polygon = {
        geometry: {
          coordinates: [
            [
              [108.4, 22.4],
              [108.6, 22.4],
              [108.6, 22.6],
              [108.4, 22.6],
              [108.4, 22.4],
            ],
          ],
        },
      }

      const result = queryByPolygon(tree, polygon)

      expect(result.length).toBeGreaterThan(0)
      expect(result.length).toBeLessThan(xiaoquData.length)

      for (const xq of result) {
        expect(xq.lng).toBeGreaterThanOrEqual(108.4)
        expect(xq.lng).toBeLessThanOrEqual(108.6)
        expect(xq.lat).toBeGreaterThanOrEqual(22.4)
        expect(xq.lat).toBeLessThanOrEqual(22.6)
      }
    })

    it('should return empty array when no points match', () => {
      const xiaoquData = [
        { id: 1, name: '小区A', lng: 100.0, lat: 20.0 },
        { id: 2, name: '小区B', lng: 100.1, lat: 20.1 },
      ]
      const tree = createSpatialIndex(xiaoquData)

      const polygon = {
        geometry: {
          coordinates: [
            [
              [110.0, 30.0],
              [110.1, 30.0],
              [110.1, 30.1],
              [110.0, 30.1],
              [110.0, 30.0],
            ],
          ],
        },
      }

      const result = queryByPolygon(tree, polygon)
      expect(result).toEqual([])
    })

    it('should handle polygon with complex shape', () => {
      const xiaoquData = [
        { id: 1, name: '内部点', lng: 108.4, lat: 22.9 },
        { id: 2, name: '外部点', lng: 108.2, lat: 22.9 },
        { id: 3, name: '边界点', lng: 108.3, lat: 22.9 },
      ]
      const tree = createSpatialIndex(xiaoquData)

      const polygon = {
        geometry: {
          coordinates: [
            [
              [108.3, 22.8],
              [108.5, 22.8],
              [108.5, 23.0],
              [108.4, 22.95],
              [108.3, 23.0],
              [108.3, 22.8],
            ],
          ],
        },
      }

      const result = queryByPolygon(tree, polygon)
      const resultIds = result.map((xq) => xq.id)

      expect(resultIds).toContain(1)
      expect(resultIds).toContain(3)
      expect(resultIds).not.toContain(2)
    })
  })

  describe('Index Filtering Effect', () => {
    it('should significantly reduce candidate count for large datasets', () => {
      const totalPoints = 1000
      const xiaoquData = Array.from({ length: totalPoints }, (_, i) => ({
        id: i + 1,
        name: `小区${i + 1}`,
        lng: 108.0 + Math.random() * 2,
        lat: 22.0 + Math.random() * 2,
      }))
      const tree = createSpatialIndex(xiaoquData)

      const polygon = {
        geometry: {
          coordinates: [
            [
              [108.4, 22.4],
              [108.6, 22.4],
              [108.6, 22.6],
              [108.4, 22.6],
              [108.4, 22.4],
            ],
          ],
        },
      }

      const result = queryByPolygon(tree, polygon)
      const candidateRatio = result.length / totalPoints

      expect(candidateRatio).toBeLessThan(0.1)
      expect(result.length).toBeGreaterThan(0)
    })

    it('should have same result as brute force for boundary cases', () => {
      const xiaoquData = [
        { id: 1, lng: 108.0, lat: 22.0 },
        { id: 2, lng: 108.0, lat: 22.0 },
        { id: 3, lng: 108.0001, lat: 22.0001 },
        { id: 4, lng: 107.9999, lat: 21.9999 },
      ]
      const tree = createSpatialIndex(xiaoquData)

      const polygon = {
        geometry: {
          coordinates: [
            [
              [108.0, 22.0],
              [108.0002, 22.0],
              [108.0002, 22.0002],
              [108.0, 22.0002],
              [108.0, 22.0],
            ],
          ],
        },
      }

      const result = queryByPolygon(tree, polygon)
      const resultIds = result.map((xq) => xq.id)

      expect(resultIds).toContain(1)
      expect(resultIds).toContain(2)
      expect(resultIds).toContain(3)
      expect(resultIds).not.toContain(4)
    })

    // 816-专项8 发现13：随机化属性测试（02 §5.6 不变量 3「粗筛保守」——粗筛漏配 = 结果错误）。
    // 原仅 4 个手工固定点，宽输入空间无证据；此处固定种子伪随机（确定性，防 flaky）
    it('randomized: 索引结果 ⊇ 逐点精确结果（多组随机点集 × 多边形）', () => {
      let seed = 42
      const rand = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648
        return seed / 2147483648
      }

      for (let trial = 0; trial < 10; trial++) {
        const n = 50 + Math.floor(rand() * 150)
        const xiaoquData = Array.from({ length: n }, (_, i) => ({
          id: i + 1,
          lng: 107.5 + rand() * 3,
          lat: 21.0 + rand() * 3,
        }))
        const tree = createSpatialIndex(xiaoquData)

        // 非退化多边形（六点凸包近似，含点在 bbox 内但多边形外的情况）
        const cx = 108 + rand() * 1.5
        const cy = 22 + rand() * 1
        const w = 0.3 + rand() * 0.6
        const h = 0.3 + rand() * 0.5
        const polygon = {
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [cx - w, cy - h],
                [cx + w * 0.6, cy - h * 1.1],
                [cx + w, cy],
                [cx + w * 0.4, cy + h],
                [cx - w * 0.8, cy + h * 0.7],
                [cx - w, cy - h],
              ],
            ],
          },
        }
        const normalized = { type: 'Feature', geometry: polygon.geometry }
        const exact = xiaoquData.filter((xq) =>
          booleanPointInPolygon(point([xq.lng, xq.lat]), normalized)
        )
        const fromIndex = queryByPolygon(tree, polygon)
        const indexIds = new Set(fromIndex.map((x) => x.id))

        // ① 不漏配：每个精确命中必须出现在索引结果中（⊇）
        for (const xq of exact) {
          expect(indexIds.has(xq.id)).toBe(true)
        }
        // ② 无误配：queryByPolygon 已做精确过滤，结果应与逐点精确一致
        expect(fromIndex.length).toBe(exact.length)
      }
    })
  })
})
