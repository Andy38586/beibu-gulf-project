import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'

// flood e2e：连真实 backend/data/flood 静态数据（公开只读 + 纯计算，免登录）。
// 真实档位表：0/2/5/8/10/15（五档有淹没多边形，0/2 档 features 为空）。
// 覆盖：五路由冒烟、向上取档（2.5→5 / 15.1→15）、超界 400、disaster POST 200 信封
describe('flood e2e（读真数据文件）', () => {
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

  it('flood-areas 无水位 → 返回 6 档全表', async () => {
    const res = await request(app.getHttpServer()).get(`${base}/flood-areas`).expect(200)
    expect(res.body.code).toBe(200)
    expect(res.body.data).toHaveLength(6)
    expect(res.body.data.map((z: { waterLevel: number }) => z.waterLevel)).toEqual([
      0, 2, 5, 8, 10, 15,
    ])
  })

  it('flood-areas?waterLevel=2.5 → 向上取档 5（中风险），features 权威注入 riskLevel', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/flood-areas?waterLevel=2.5`)
      .expect(200)
    expect(res.body.data.requestedWaterLevel).toBe(2.5)
    expect(res.body.data.actualWaterLevel).toBe(5)
    expect(res.body.data.riskLevel).toBe('中风险')
    expect(res.body.data.features.length).toBeGreaterThan(0)
    for (const f of res.body.data.features) {
      expect(f.properties.riskLevel).toBe('中风险')
    }
  })

  it('flood-areas?waterLevel=15.1 → 超档取最高档 15（灾难级，宁可高估）', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/flood-areas?waterLevel=15.1`)
      .expect(200)
    expect(res.body.data.actualWaterLevel).toBe(15)
    expect(res.body.data.riskLevel).toBe('灾难级')
  })

  it('flood-areas?waterLevel=0 → 命中 0 档（无风险，空淹没）', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/flood-areas?waterLevel=0`)
      .expect(200)
    expect(res.body.data.actualWaterLevel).toBe(0)
    expect(res.body.data.riskLevel).toBe('无风险')
    expect(res.body.data.features).toEqual([])
  })

  it('flood-statistics?waterLevel=5 → 命中 5 档统计', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/flood-statistics?waterLevel=5`)
      .expect(200)
    expect(res.body.data.waterLevel).toBe(5)
    expect(res.body.data.floodArea).toBe(576.91)
  })

  it('flood-statistics 无水位 → 全表 6 档', async () => {
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

  it('POST analysis/disaster waterLevel=8 → 200 信封 + 高风险档位（真数据 0 设施命中，合法空评估）', async () => {
    const res = await request(app.getHttpServer())
      .post(`${base}/analysis/disaster`)
      .send({ waterLevel: 8 })
      .expect(200) // Express sendSuccess 默认 200，非 201
    expect(res.body.code).toBe(200)
    expect(res.body.data.riskLevel).toBe('高风险')
    expect(res.body.data.requestedWaterLevel).toBe(8)
    expect(res.body.data.waterLevel).toBe(8)
    // 实跑 turf 校验过：真数据 5/8/10 档设施命中均为 0（设施点不在淹没多边形内），空评估是合法 data
    expect(res.body.data.affectedFacilities).toEqual([])
    expect(res.body.data.totalLoss).toBe(0)
  })

  it('POST analysis/disaster waterLevel=15 → 命中 1 设施（真数据实跑 loss=3600）', async () => {
    const res = await request(app.getHttpServer())
      .post(`${base}/analysis/disaster`)
      .send({ waterLevel: 15 })
      .expect(200)
    expect(res.body.data.riskLevel).toBe('灾难级')
    expect(res.body.data.affectedFacilities).toHaveLength(1)
    expect(res.body.data.totalLoss).toBe(3600)
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

  it('POST analysis/disaster 缺水位 → 400 文案逐字节', async () => {
    const res = await request(app.getHttpServer())
      .post(`${base}/analysis/disaster`)
      .send({})
      .expect(400)
    expect(res.body).toEqual({ code: 400001, error: '缺少水位参数', data: null })
  })
})
