import { describe, expect, it, vi } from 'vitest'

import { DbService } from '../src/infra/db/db.service'
import { isFatalDbError } from '../src/infra/db/db-error'
import {
  type GeoJsonFeature,
  type GeoJsonGeometry,
  SpatialRepository,
} from '../src/infra/db/spatial.repository'

// 空间算子错误分类守卫（审查 H-2 回归）：可降级 catch 必须区分「几何/参数类错误」
// 与「连接级故障」。连接级故障吞成 null/[] 会让灾害评估以 200 返回"零受损"（假绿灯），
// 必须显式上抛 → 全局异常过滤 5xx。真库语义套件见 spatial.repository.spec.ts
//（V3_INTEGRATION_DB 门控）；此处 mock DbService 专测错误分类路径。

function makeRepo(queryError: unknown): SpatialRepository {
  const db = { query: vi.fn().mockRejectedValue(queryError) }
  return new SpatialRepository(db as unknown as DbService)
}

const CONNECTION_ERRORS = [
  { code: '08006' }, // PG connection_failure
  { code: '57P01' }, // PG admin_shutdown
  { code: '53300' }, // PG too_many_connections
  { code: 'ECONNREFUSED' }, // Node 拨号失败（pool 层系统错误，无 PG code）
]

const DEGRADABLE_ERRORS = [
  { code: '22023' }, // PG invalid_parameter_value（几何参数类）
  { code: 'XX000' }, // PG internal_error（GEOS 计算崩溃类）
  new Error('no code at all'), // 未知形态：宁可降级不可误杀业务空结果语义
]

const POINT = { lng: 108.5, lat: 21.7 }
const POLYGON: GeoJsonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ],
}
const FEATURE: GeoJsonFeature = { type: 'Feature', properties: {}, geometry: POLYGON }

describe('isFatalDbError — 连接级故障判定', () => {
  for (const e of CONNECTION_ERRORS) {
    it(`${e.code} → 致命`, () => {
      expect(isFatalDbError(e)).toBe(true)
    })
  }
  for (const e of DEGRADABLE_ERRORS) {
    it(`${(e as { code?: string }).code ?? 'generic'} → 可降级`, () => {
      expect(isFatalDbError(e)).toBe(false)
    })
  }
  it('null/undefined → 可降级', () => {
    expect(isFatalDbError(null)).toBe(false)
  })
})

describe('空间算子：连接级故障上抛、几何类保留降级契约', () => {
  for (const e of CONNECTION_ERRORS) {
    it(`unionBuffers 遇 ${e.code} → rejects`, async () => {
      await expect(makeRepo(e).unionBuffers([POINT], 3)).rejects.toBe(e)
    })
    it(`intersect 遇 ${e.code} → rejects`, async () => {
      await expect(makeRepo(e).intersect(FEATURE, FEATURE)).rejects.toBe(e)
    })
    it(`pointIndicesInGeometry 遇 ${e.code} → rejects`, async () => {
      await expect(makeRepo(e).pointIndicesInGeometry([POINT], POLYGON)).rejects.toBe(e)
    })
    it(`pointIndicesInAnyPolygon 遇 ${e.code} → rejects`, async () => {
      await expect(makeRepo(e).pointIndicesInAnyPolygon([POINT], [POLYGON])).rejects.toBe(e)
    })
  }

  it('unionBuffers 遇几何参数错误 → null（原降级契约不变）', async () => {
    await expect(makeRepo({ code: '22023' }).unionBuffers([POINT], 3)).resolves.toBeNull()
  })
  it('intersect 遇几何参数错误 → null', async () => {
    await expect(makeRepo({ code: 'XX000' }).intersect(FEATURE, FEATURE)).resolves.toBeNull()
  })
  it('pointIndicesInGeometry 遇几何参数错误 → []', async () => {
    await expect(
      makeRepo({ code: '22023' }).pointIndicesInGeometry([POINT], POLYGON)
    ).resolves.toEqual([])
  })
  it('pointIndicesInAnyPolygon 遇几何参数错误 → []', async () => {
    await expect(
      makeRepo({ code: '22023' }).pointIndicesInAnyPolygon([POINT], [POLYGON])
    ).resolves.toEqual([])
  })
})
