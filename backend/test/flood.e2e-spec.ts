import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'

// flood e2e：连真实 backend/data/flood 静态数据 + PostGIS `flood_levels` 档位表
//（公开只读 + 纯计算，免登录）。
//
// ⚠️ 2026-09-10 迁移影响：档位淹没范围的数据源由 floodArea.json（**6 档**：0/2/5/8/10/15）
// 改为 PostGIS `flood_levels`（**251 档**，0.1m 步长）。故 flood-areas 与 disaster 两类
// 用例改由 V3_INTEGRATION_DB 门控（与 flood.controller.spec.ts 的 withDb 同口径）——
// 无库环境（CI）跳过，避免表缺失导致 500 噪音；有库时验证 0.1 步长精度（非 6 档粗化）。
// 其余端点（flood-statistics / terrain-profiles / water-area）仍读 JSON，无库照常跑。
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

  it('flood-statistics?waterLevel=5 → 命中 5 档统计', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/flood-statistics?waterLevel=5`)
      .expect(200)
    expect(res.body.data.waterLevel).toBe(5)
    expect(res.body.data.floodArea).toBe(576.91)
  })

  it('flood-statistics 无水位 → 全表 6 档（该端点在本次改造中未迁移）', async () => {
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
      it('flood-areas 无水位 → 返回全部 251 档', async () => {
        const res = await request(app.getHttpServer()).get(`${base}/flood-areas`).expect(200)
        expect(res.body.code).toBe(200)
        const levels = res.body.data.map((z: { waterLevel: number }) => z.waterLevel)
        expect(levels).toHaveLength(251)
        expect(levels[0]).toBe(0)
        expect(levels[levels.length - 1]).toBe(25)
      })

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

      it('POST analysis/disaster waterLevel=8 → 200 信封 + 高风险档位 + 设施真实命中', async () => {
        const res = await request(app.getHttpServer())
          .post(`${base}/analysis/disaster`)
          .send({ waterLevel: 8 })
          .expect(200)
        expect(res.body.code).toBe(200)
        expect(res.body.data.riskLevel).toBe('高风险')
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
