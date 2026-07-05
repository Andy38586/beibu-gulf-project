import { describe, it, expect } from 'vitest'
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
      expect(queryByPolygon(tree, {
        geometry: { coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      })).toEqual([])
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
  })
})