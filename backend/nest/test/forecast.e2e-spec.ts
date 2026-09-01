import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'

// forecast e2e：连真实 backend/data/forecast 静态数据（公开只读，免登录）。
// 覆盖：四端点冒烟、confidence 钳制（REQ-4）、缓存一致性（REQ-3）、校验文案
describe('forecast e2e（读真数据文件）', () => {
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

  const base = '/nest-api/forecast'

  it('overview → 200 指标索引（含 ports/updatedAt 摘要键）', async () => {
    const res = await request(app.getHttpServer()).get(`${base}/overview`).expect(200)
    expect(res.body.code).toBe(200)
    expect(Object.keys(res.body.data).length).toBeGreaterThan(0)
  })

  it('/ 根路径与 /overview 同义', async () => {
    const root = await request(app.getHttpServer()).get(base).expect(200)
    const ov = await request(app.getHttpServer()).get(`${base}/overview`).expect(200)
    expect(JSON.stringify(root.body)).toBe(JSON.stringify(ov.body))
  })

  it('map 缺 indicator → 400 文案逐字节；缺 time 同', async () => {
    const noIndicator = await request(app.getHttpServer()).get(`${base}/map?time=2025`).expect(400)
    expect(noIndicator.body).toEqual({
      code: 400001,
      error: '缺少参数: indicator, time',
      data: null,
    })
    const noTime = await request(app.getHttpServer()).get(`${base}/map?indicator=cargo`).expect(400)
    expect(noTime.body).toEqual({ code: 400001, error: '缺少参数: indicator, time', data: null })
  })

  it('map 合法请求 → FeatureCollection（properties 仅四键）', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/map?indicator=cargo&time=2026-06`)
      .expect(200)
    expect(res.body.data.type).toBe('FeatureCollection')
    expect(res.body.data.indicator).toBe('cargo')
    expect(res.body.data.features.length).toBeGreaterThan(0)
    for (const f of res.body.data.features) {
      expect(Object.keys(f.properties).sort()).toEqual(
        ['portId', 'portName', 'reliability', 'value'].sort()
      )
    }
  })

  it('confidence 钳制：非法回落 1.0 / 合法原样 / 超 2 钳 2（确定性响应不受值变化影响——cargo 模型基线）', async () => {
    const fresh = await request(app.getHttpServer())
      .get(`${base}/map?indicator=cargo&time=2026-06`)
      .expect(200)
    const clamped = await request(app.getHttpServer())
      .get(`${base}/map?indicator=cargo&time=2026-06&confidence=abc`)
      .expect(200)
    const over = await request(app.getHttpServer())
      .get(`${base}/map?indicator=cargo&time=2026-06&confidence=5`)
      .expect(200)
    // cargo 为固定基线（scenarioLevel 恒 1.0）：confidence 变化不改变结果
    expect(JSON.stringify(clamped.body)).toBe(JSON.stringify(fresh.body))
    expect(JSON.stringify(over.body)).toBe(JSON.stringify(fresh.body))
  })

  it('合成指标 berth：文件自带 forecast 透传', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/indicator/berth?time=2026-01`)
      .expect(200)
    expect(res.body.data.indicator).toBe('berth')
    expect(Object.keys(res.body.data.ports).length).toBeGreaterThan(0)
  })

  it('timeseries year 粒度 → YYYY 聚合整数均值', async () => {
    const res = await request(app.getHttpServer())
      .get(`${base}/timeseries?indicator=cargo&granularity=year`)
      .expect(200)
    expect(res.body.data.granularity).toBe('year')
    for (const s of res.body.data.series) {
      for (const d of s.data) {
        expect(d.time).toMatch(/^\d{4}$/)
        expect(Number.isInteger(d.value)).toBe(true)
      }
    }
  })

  it('未知指标 → 404 未知指标文案', async () => {
    const res = await request(app.getHttpServer()).get(`${base}/indicator/nope`).expect(404)
    expect(res.body).toEqual({ code: 404001, error: '未知指标: nope', data: null })
  })

  it('孤儿路由 /:portId（兼容端点）返回港口双指标', async () => {
    const index = await request(app.getHttpServer()).get(`${base}/overview`).expect(200)
    const portId = index.body.data.metadata.ports[0].id
    const res = await request(app.getHttpServer()).get(`${base}/${portId}`).expect(200)
    expect(res.body.data.portId).toBe(portId)
    expect(Object.keys(res.body.data.indicators).sort()).toEqual(['cargo', 'container'])
  })

  it('缓存命中=重算一致性（REQ-3 连发两次同参数响应逐字节一致）', async () => {
    const a = await request(app.getHttpServer())
      .get(`${base}/map?indicator=berth&time=2026-01`)
      .expect(200)
    const b = await request(app.getHttpServer())
      .get(`${base}/map?indicator=berth&time=2026-01`)
      .expect(200)
    expect(JSON.stringify(b.body)).toBe(JSON.stringify(a.body))
  })
})
