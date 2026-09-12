import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'
import { DbService } from '../src/infra/db/db.service'

// flood e2e：连真实 backend/data/flood 静态数据 + PostGIS `flood_levels` 档位表
//（公开只读 + 纯计算，免登录）。
//
// ⚠️ 2026-09-10 迁移影响：档位淹没范围的数据源由 floodArea.json（**6 档**：0/2/5/8/10/15）
// 改为 PostGIS `flood_levels`（**251 档**，0.1m 步长）。故 flood-areas 与 disaster 两类
// 用例改由 V3_INTEGRATION_DB 门控（与 flood.controller.spec.ts 的 withDb 同口径）——
// 无库环境（CI）跳过，避免表缺失导致 500 噪音；有库时验证 0.1 步长精度（非 6 档粗化）。
// 2026-09-11 起 flood-statistics 指定水位路径同样改走 PostGIS（与 areas/disaster 同源，
// 修复 6 档粗化 + 设施数/损失陈旧），故带水位的统计用例一并纳入门控；
// 仅「无水位 → 6 档参考表」保持无库可跑。
describe('flood e2e（真数据文件 + 真库档位表）', () => {
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

  const base = '/nest-api/flood'

  // ───────────────────────── 静态文件端点（无库可跑） ─────────────────────────

  it('flood-statistics 无水位 → 6 档参考表（兼容契约）', async () => {
    const res = await request(app.getHttpServer()).get(`${base}/flood-statistics`).expect(200)
    expect(res.body.data).toHaveLength(6)
  })

  it('terrain-profiles → 4 条剖面逐条注入 datumOffset=2.5（真 DEM 基准偏移）', async () => {
    const res = await request(app.getHttpServer()).get(`${base}/terrain-profiles`).expect(200)
    expect(res.body.data).toHaveLength(4)
    for (const p of res.body.data) {
      expect(p.datumOffset).toBe(2.5)
    }
  })

  it('water-area → 坐标数组（7 点）', async () => {
    const res = await request(app.getHttpServer()).get(`${base}/water-area`).expect(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data).toHaveLength(7)
    expect(res.body.data[0]).toHaveLength(2)
  })

  it('waterLevel 超界（26）→ 400 文案逐字节', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/flood-areas?waterLevel=26`)
      .expect(400)
    expect(res.body).toEqual({
      code: 400001,
      error: '水位参数无效（需 0–25 的有限数值）',
      data: null,
    })
  })

  it('waterLevel 非数字（abc）→ 400', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/flood-areas?waterLevel=abc`)
      .expect(400)
    expect(res.body.code).toBe(400001)
  })

  it('POST analysis/disaster 缺水位 → 400 文案逐字节', async () => {
    const res = await request(app.getHttpServer())
      .post(`${base}/analysis/disaster`)
      .send({})
      .expect(400)
    expect(res.body).toEqual({ code: 400001, error: '缺少水位参数', data: null })
  })

  // ─────────────── PostGIS 档位表端点（需真库：V3_INTEGRATION_DB=1） ───────────────
  // 前置：建表 tools/db/db-schema-flood.sql + 灌数 node tools/flood/flood-levels-to-pg.mjs
  describe.skipIf(process.env.V3_INTEGRATION_DB === undefined)(
    'PostGIS 档位表（251 档，0.1m 步长）',
    () => {
      it(
        'flood-areas 无水位 → 返回全部 251 档',
        // 2026-09-12：取档几何加 ST_IsValid/ST_MakeValid 自愈门控后，全档兼容路径
        //（4869 片 transform+校验）SQL 实测 ~4.4s，超 vitest 默认 5s —— 本路径为
        // 兼容保留（前端恒传 waterLevel，真实 UI 走轻量取档路径），放宽本用例超时
        { timeout: 15_000 },
        async () => {
          const res = await request(app.getHttpServer()).get(`${base}/flood-areas`).expect(200)
          expect(res.body.code).toBe(200)
          const levels = res.body.data.map((z: { waterLevel: number }) => z.waterLevel)
          expect(levels).toHaveLength(251)
          expect(levels[0]).toBe(0)
          expect(levels[levels.length - 1]).toBe(25)
        }
      )

      it('flood-areas?waterLevel=3.47 → 向上取档 3.5（0.1 步长精度，非 6 档粗化）', async () => {
        const res = await request(app.getHttpServer())
          .get(`${base}/flood-areas?waterLevel=3.47`)
          .expect(200)
        expect(res.body.data.requestedWaterLevel).toBe(3.47)
        // 6 档时代这里会返回 5；251 档时代应精确到 3.5
        expect(res.body.data.actualWaterLevel).toBe(3.5)
        expect(res.body.data.riskLevel).toBe('中风险')
      })

      it('flood-areas?waterLevel=2.5 → 命中 2.5 档（等值命中），features 权威注入 riskLevel', async () => {
        const res = await request(app.getHttpServer())
          .get(`${base}/flood-areas?waterLevel=2.5`)
          .expect(200)
        expect(res.body.data.requestedWaterLevel).toBe(2.5)
        expect(res.body.data.actualWaterLevel).toBe(2.5)
        expect(res.body.data.riskLevel).toBe('中风险')
        expect(res.body.data.features.length).toBeGreaterThan(0)
        for (const f of res.body.data.features) {
          expect(f.properties.riskLevel).toBe('中风险')
          expect(typeof f.properties.area).toBe('number')
        }
      })

      it('flood-areas?waterLevel=25.5 → 超界 400（上限 25，超档兜底由 SQL 覆盖 0-25 内）', async () => {
        await request(app.getHttpServer()).get(`${base}/flood-areas?waterLevel=25.5`).expect(400)
      })

      it('flood-areas?waterLevel=0 → 命中 0 档（无风险，空淹没）', async () => {
        const res = await request(app.getHttpServer())
          .get(`${base}/flood-areas?waterLevel=0`)
          .expect(200)
        expect(res.body.data.actualWaterLevel).toBe(0)
        expect(res.body.data.riskLevel).toBe('无风险')
        expect(res.body.data.features).toEqual([])
      })

      it('flood-areas?waterLevel=3 → 陆域裁剪：几何非空且全部落在行政区划包络内（生产 500 事故回归）', async () => {
        // 2026-09-12 生产事故形态：admin_boundary_union 缺失 → PICK_LEVEL_SQL 的
        // ST_Intersection 直接 500；SRID 错配（4490 元数据）→ mixed SRID 也 500。
        // 故本用例同时守住：① 端点不 500；② 裁剪真实生效（几何 ⊆ 行政区划包络）。
        const res = await request(app.getHttpServer())
          .get(`${base}/flood-areas?waterLevel=3`)
          .expect(200)
        const features = res.body.data.features as Array<{
          geometry: { type: string; coordinates: unknown }
          properties: { area: number }
        }>
        expect(features.length).toBeGreaterThan(0)

        // 上界取自库内真值（不硬编码坐标窗）：行政区划换版时断言自动跟随，
        // 只有「裁剪失效 → 越界几何（如海上原始档位面）」才会红
        const db = app.get(DbService)
        const env = await db.query<{ minx: number; miny: number; maxx: number; maxy: number }>(
          `SELECT ST_XMin(e)::float8 AS minx, ST_YMin(e)::float8 AS miny,
                  ST_XMax(e)::float8 AS maxx, ST_YMax(e)::float8 AS maxy
             FROM (SELECT ST_Envelope(geom) AS e FROM admin_boundary_union) t`
        )
        const { minx, miny, maxx, maxy } = env.rows[0]
        // 仅吸收 4490→4326 转换的浮点级误差
        const EPS = 1e-6

        const coords: Array<[number, number]> = []
        const walk = (node: unknown): void => {
          if (!Array.isArray(node)) return
          if (typeof node[0] === 'number' && typeof node[1] === 'number') {
            coords.push([node[0], node[1]])
            return
          }
          for (const child of node) walk(child)
        }
        for (const f of features) {
          // ST_Dump 逐部件下发 → 单部件为 Polygon，多部件为 MultiPolygon
          expect(f.geometry.type).toMatch(/^(Multi)?Polygon$/)
          expect(typeof f.properties.area).toBe('number')
          walk(f.geometry.coordinates)
        }
        expect(coords.length).toBeGreaterThan(0)
        for (const [lng, lat] of coords) {
          expect(lng).toBeGreaterThanOrEqual(minx - EPS)
          expect(lng).toBeLessThanOrEqual(maxx + EPS)
          expect(lat).toBeGreaterThanOrEqual(miny - EPS)
          expect(lat).toBeLessThanOrEqual(maxy + EPS)
        }
      })

      it('flood-statistics?waterLevel=2.5 → 档位与 flood-areas 同源（旧 6 档实现会粗化到 5）', async () => {
        const [areasRes, statsRes] = await Promise.all([
          request(app.getHttpServer()).get(`${base}/flood-areas?waterLevel=2.5`).expect(200),
          request(app.getHttpServer()).get(`${base}/flood-statistics?waterLevel=2.5`).expect(200),
        ])
        expect(statsRes.body.data.waterLevel).toBe(areasRes.body.data.actualWaterLevel)
        expect(statsRes.body.data.waterLevel).toBe(2.5)
        expect(statsRes.body.data.riskLevel).toBe(areasRes.body.data.riskLevel)
        // 面积来自档位表 flooded_km2（原值透传）；水深仍标参考档位 5（6 档反演表）
        expect(typeof statsRes.body.data.floodArea).toBe('number')
        expect(statsRes.body.data.depthRefLevel).toBe(5)
      })

      it('flood-statistics 与 analysis/disaster 同水位设施数/损失一致（同一次点面判定）', async () => {
        const [statsRes, disasterRes] = await Promise.all([
          request(app.getHttpServer()).get(`${base}/flood-statistics?waterLevel=8`).expect(200),
          request(app.getHttpServer())
            .post(`${base}/analysis/disaster`)
            .send({ waterLevel: 8 })
            .expect(200),
        ])
        expect(statsRes.body.data.waterLevel).toBe(8)
        // 水文锚定重划：8 ≤ 8 → 极高风险带（code 4）
        expect(statsRes.body.data.riskLevelCode).toBe(4)
        expect(statsRes.body.data.affectedFacilityCount).toBe(
          disasterRes.body.data.affectedFacilities.length
        )
        expect(statsRes.body.data.estimatedLoss).toBe(disasterRes.body.data.totalLoss)
        expect(statsRes.body.data.affectedPorts.length).toBeGreaterThan(0)
      })

      it('POST analysis/disaster waterLevel=8 → 200 信封 + 极高风险档位 + 设施真实命中', async () => {
        const res = await request(app.getHttpServer())
          .post(`${base}/analysis/disaster`)
          .send({ waterLevel: 8 })
          .expect(200)
        expect(res.body.code).toBe(200)
        // 水文锚定重划：8 ≤ 8 → 极高风险（原 0/2/5/8/10/15 口径下为 高风险）
        expect(res.body.data.riskLevel).toBe('极高风险')
        expect(res.body.data.requestedWaterLevel).toBe(8)
        expect(res.body.data.waterLevel).toBe(8)
        // 2026-09-11 修复 SRID 混用前此处断言为 toEqual([])——那是把故障当规格：
        // flood_levels.geom 为 4490，repository 漏 ST_Transform 取出后与 4326 探针点
        // 做 ST_Covers 抛 mixed SRID，被 spatial.repository.ts 上空 catch 吞成 []。
        // 修复后本档实测命中 42 个设施（与 psql 离线预测一致）。
        expect(res.body.data.affectedFacilities.length).toBeGreaterThan(0)
        expect(res.body.data.totalLoss).toBeGreaterThan(0)
        for (const f of res.body.data.affectedFacilities) {
          expect(typeof f.name).toBe('string')
          expect(typeof f.lng).toBe('number')
          expect(typeof f.lat).toBe('number')
        }
      })

      it('POST analysis/disaster waterLevel=15 → 灾难级（设施命中数依真库数据而定）', async () => {
        const res = await request(app.getHttpServer())
          .post(`${base}/analysis/disaster`)
          .send({ waterLevel: 15 })
          .expect(200)
        expect(res.body.data.riskLevel).toBe('灾难级')
        expect(res.body.data.waterLevel).toBe(15)
        expect(Array.isArray(res.body.data.affectedFacilities)).toBe(true)
      })

      it('POST analysis/disaster waterLevel=0 → 无风险零损失（waterLevel undefined 键被 JSON 丢弃）', async () => {
        const res = await request(app.getHttpServer())
          .post(`${base}/analysis/disaster`)
          .send({ waterLevel: 0 })
          .expect(200)
        expect(res.body.data.riskLevel).toBe('无风险')
        expect(res.body.data.totalLoss).toBe(0)
        expect(res.body.data).not.toHaveProperty('waterLevel')
      })
    }
  )
})
