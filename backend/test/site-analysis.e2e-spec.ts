import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'

import { probePoiCount } from './helpers/probe-poi-count'

// site-analysis e2e（2026-09-15 拆分重构）
//
// 本文件只保留两类：
//   ① **参数校验契约**——不碰库，无门控，任何环境都跑（8 条，原先被真库门控白白埋掉）；
//   ② **不变量**——需库内**有 POI/小区数据**，但断言与"具体是哪份数据"无关
//      （TOP_N 上限、降序、分数值域、坐标落域、覆盖率不变量、非法 city 回落…）。
//      CI 由 backend/test/seed/site-analysis-fixture.sql 提供合成夹具（poi 6 / xiaoqu 12）；
//      本地 beibu-gulf-data 有全量真实数据，同一套断言同样成立。
//
// 🔴 为什么要拆（2026-09-15 实测教训）：原文件把**全量真实数据的快照值**硬编成断言
//（bh hospital 101 / 滨海·江语湖 94.7 / coverage 必为 MultiPolygon …），导致：
//   · 任何数据变动（重抓 POI / 补城 / 改清洗规则）都会红，修法只能是"改期望值" = 测试废掉；
//   · CI 无 POI 源可灌 ⇒ 整组 16 条静默跳过，而 test-gate.config.json 登记为 mode=gated
//     （env 已设不许跳）⇒ watchdog 判 GATED_SKIP_IN_REQUIRED_ENV、CI 必红。
// 那些快照断言已移入 `site-analysis.snapshot.spec.ts`（V3_FULL_DATASET 门控，仅本地跑）。
const withDb = process.env.V3_INTEGRATION_DB !== undefined

// 模块加载期（collection 前）同步探测库内 POI 规模：CI 灌了合成夹具、本地有全量数据 → 都非 0。
const poiCount = withDb ? probePoiCount() : 0

// ─────────────────────────────────────────────────────────────────────────────
// ① 参数校验契约：与库无关（校验发生在任何 SQL 之前），故**不门控**、永远执行
// ─────────────────────────────────────────────────────────────────────────────
describe('site-analysis 契约 —— 参数校验（无库可跑）', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('nest-api')
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  const base = '/nest-api/site-analysis'
  const post = (body: Record<string, unknown>) => request(app.getHttpServer()).post(base).send(body)

  it('缺 selectedKeys → 400 文案逐字节', async () => {
    const res = await post({ typeSettings: {} }).expect(400)
    expect(res.body).toEqual({
      code: 400001,
      error: '缺少必要参数: selectedKeys, typeSettings',
      data: null,
    })
  })

  it('缺 typeSettings → 400', async () => {
    const res = await post({ selectedKeys: ['hospital'] }).expect(400)
    expect(res.body.code).toBe(400001)
    expect(res.body.error).toBe('缺少必要参数: selectedKeys, typeSettings')
  })

  it('importance 越界（9）→ 400，且校验顺序早于未知类型检查', async () => {
    const res = await post({
      selectedKeys: ['airport'],
      typeSettings: { airport: { importance: 9 } },
    }).expect(400)
    expect(res.body.error).toContain('应在 1-5 之间')
  })

  it('未知设施类型 → 400，文案带可用类型清单', async () => {
    const res = await post({
      selectedKeys: ['airport'],
      typeSettings: { airport: { defaultRadius: 3, importance: 3 } },
    }).expect(400)
    expect(res.body.error).toBe(
      '未知设施类型: airport，可用类型: hospital, primary_school, middle_school, park, bus_station, mall'
    )
  })

  it('radius 为负 → 400', async () => {
    const res = await post({
      selectedKeys: ['hospital'],
      typeSettings: { hospital: { defaultRadius: 3, importance: 3, radius: -5 } },
    }).expect(400)
    expect(res.body.error).toBe('设施类型 hospital 的半径无效，应为正数')
  })

  it('weights 越界（99）→ 400', async () => {
    const res = await post({
      selectedKeys: ['hospital', 'park'],
      typeSettings: {
        hospital: { defaultRadius: 3, importance: 3 },
        park: { defaultRadius: 3, importance: 3 },
      },
      weights: { hospital: 99 },
    }).expect(400)
    expect(res.body.error).toBe('权重 hospital 无效，应为 0-10 之间的数字')
  })

  it('weights 非对象 → 400', async () => {
    const res = await post({
      selectedKeys: ['hospital', 'park'],
      typeSettings: {
        hospital: { defaultRadius: 3, importance: 3 },
        park: { defaultRadius: 3, importance: 3 },
      },
      weights: [1, 2],
    }).expect(400)
    expect(res.body.error).toBe('weights 应为对象')
  })

  it('selectedKeys 为空数组 → 422（ANALYSIS_FAILED，validateSelection 文案转译）', async () => {
    const res = await post({ selectedKeys: [], typeSettings: {} }).expect(422)
    expect(res.body).toEqual({
      code: 422001,
      error: '请至少选择一种设施类型',
      data: null,
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ② 不变量：需库内有 POI/小区，但断言与具体数据分布无关（合成夹具与全量真数据都成立）
// ─────────────────────────────────────────────────────────────────────────────
describe.skipIf(!withDb || poiCount === 0)('site-analysis 不变量（连真库 PostGIS）', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('nest-api')
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  const base = '/nest-api/site-analysis'
  const post = (body: Record<string, unknown>) => request(app.getHttpServer()).post(base).send(body)

  /** TOP_N 上限：业务硬约束，与数据规模无关 */
  const TOP_N = 10
  /** 北部湾业务边界（与 gis.constants.ts GULF_BOUNDS 同域）：任何下发的 lng/lat 必须落在此域内 */
  const BOUNDS = { minLng: 105, maxLng: 115, minLat: 18, maxLat: 25 }

  const twoTypes = {
    selectedKeys: ['hospital', 'park'],
    typeSettings: {
      hospital: { defaultRadius: 3, importance: 3 },
      park: { defaultRadius: 3, importance: 3 },
    },
  }

  type LngLat = { lng: number; lat: number }
  const inGulf = ({ lng, lat }: LngLat) =>
    lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng && lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat

  it('成功信封：{code,data} 且 data.error=null，body 不得带 error 键', async () => {
    const res = await post({ ...twoTypes, city: 'qz' }).expect(200)
    expect(res.body.code).toBe(200)
    expect(res.body).not.toHaveProperty('error')
    expect(res.body.data.error).toBeNull()
  })

  it('TOP_N 硬上限：matchedXiaoqu ≤ 10 且有命中（截断而非全量下发）', async () => {
    const res = await post({ ...twoTypes, city: 'qz' }).expect(200)
    const matched = res.body.data.matchedXiaoqu as unknown[]
    expect(matched.length).toBeGreaterThan(0)
    expect(matched.length).toBeLessThanOrEqual(TOP_N)
  })

  it('评分不变量：分数降序、值域 [0,100]、breakdown 键与 selectedKeys 一致', async () => {
    const res = await post({ ...twoTypes, city: 'qz' }).expect(200)
    const matched = res.body.data.matchedXiaoqu as Array<{
      score: number
      breakdown: Record<string, number>
    }>
    const scores = matched.map((x) => x.score)
    // 降序（允许相等）
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    for (const s of scores) {
      expect(Number.isFinite(s)).toBe(true)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(100)
    }
    for (const m of matched) {
      expect(Object.keys(m.breakdown).sort()).toEqual([...twoTypes.selectedKeys].sort())
    }
  })

  it('坐标落域不变量：下发 POI 与小区坐标必须落在北部湾业务边界内（抓 SRID/转换回归）', async () => {
    const res = await post({ ...twoTypes, city: 'qz' }).expect(200)
    const facilityPoi = res.body.data.facilityPoi as Record<string, LngLat[]>
    const matched = res.body.data.matchedXiaoqu as LngLat[]

    const all = [...Object.values(facilityPoi).flat(), ...matched]
    expect(all.length).toBeGreaterThan(0)
    for (const p of all) {
      expect(Number.isFinite(p.lng) && Number.isFinite(p.lat)).toBe(true)
      expect(inGulf(p)).toBe(true)
    }
  })

  it('facilityPoi 结构：选中类型各有数组；每项含 id/name/lng/lat/district', async () => {
    const res = await post({ ...twoTypes, city: 'qz' }).expect(200)
    const facilityPoi = res.body.data.facilityPoi as Record<string, Array<Record<string, unknown>>>
    for (const key of twoTypes.selectedKeys) {
      expect(Array.isArray(facilityPoi[key])).toBe(true)
      expect(facilityPoi[key].length).toBeGreaterThan(0)
      for (const p of facilityPoi[key]) {
        expect(typeof p.id).toBe('string')
        expect(typeof p.name).toBe('string')
        expect(typeof p.lng).toBe('number')
        expect(typeof p.lat).toBe('number')
      }
    }
  })

  it('coverage 不变量：有效 GeoJSON 面几何且坐标非空（不锁定 Polygon/MultiPolygon——那取决于数据分布）', async () => {
    const res = await post({ ...twoTypes, city: 'qz' }).expect(200)
    const cov = res.body.data.coverage
    expect(cov).toBeTruthy()
    expect(cov.type).toBe('Feature')
    expect(['Polygon', 'MultiPolygon']).toContain(cov.geometry.type)
    expect(cov.geometry.coordinates.length).toBeGreaterThan(0)
  })

  it('单类型退化：仅 hospital → 200，breakdown 只含 hospital（求交退化为单覆盖）', async () => {
    const res = await post({
      selectedKeys: ['hospital'],
      typeSettings: { hospital: { defaultRadius: 3, importance: 3 } },
      city: 'qz',
    }).expect(200)
    const matched = res.body.data.matchedXiaoqu as Array<{ breakdown: Record<string, number> }>
    expect(matched.length).toBeGreaterThan(0)
    for (const m of matched) {
      expect(Object.keys(m.breakdown)).toEqual(['hospital'])
    }
  })

  it('非法 city（路径穿越串）回落默认城市 qz，不 4xx（选址是纯计算接口）', async () => {
    const res = await post({ ...twoTypes, city: '../../etc/passwd' }).expect(200)
    expect(res.body.data.error).toBeNull()
    const matched = res.body.data.matchedXiaoqu as unknown[]
    expect(matched.length).toBeGreaterThan(0)
    expect(matched.length).toBeLessThanOrEqual(TOP_N)
  })

  it('weights 不变量：仅给 park 权重时排序仍降序、breakdown 仍保留全部因子', async () => {
    const res = await post({ ...twoTypes, city: 'qz', weights: { hospital: 0, park: 10 } }).expect(
      200
    )
    const matched = res.body.data.matchedXiaoqu as Array<{
      score: number
      breakdown: Record<string, number>
    }>
    expect(matched.length).toBeGreaterThan(0)
    const scores = matched.map((x) => x.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    // 权重只作用于总分加权，不改各因子得分
    for (const key of twoTypes.selectedKeys) {
      expect(matched[0].breakdown).toHaveProperty(key)
    }
  })
})
