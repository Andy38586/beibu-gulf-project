import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'

// site-suitability 入参错误的 HTTP 层回归（专项3 TS-1002-01 / 专项8 W6-01 同解）。
//
// 修复前的真实链路（静态三段已复核，HTTP 那一格当时记"未取证"）：query 非数值 →
// dto 裸 throw new Error → 全局过滤器不认（非 BusinessError / 非 HttpException）→
// 落到"未捕获异常"分支 → **500 + code 500001**。用户拖滑块输错一个值就是服务器错误。
// 本件实跑 HTTP：非法入参必须 400 + 400001；合法入参不得被判 400001（阳性对照）。
//
// 门控：前两条不依赖真库（compute 在校验通过后才查库）；第三条只证明"400001 不是万能回包"，
// 故不设门控。**出参契约那条**（200 / FeatureCollection 非空 / properties.id 是 number）
// 依赖真库数据 ⇒ 按 V3_INTEGRATION_DB 门控；CI 侧由 backend/test/seed/suitability-cells-fixture.sql
// 提供 7 格合成因子面（用户 2026-10-03 裁定「只加 CI 种子」），本地真库已有全量面。
const withDb = process.env.V3_INTEGRATION_DB !== undefined

describe('site-suitability 入参非法 ⇒ HTTP 4xx（修前 500）', () => {
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

  it('w_inundation=abc ⇒ 400 + code 400001', async () => {
    const res = await request(app.getHttpServer()).get(
      '/nest-api/site-suitability/map?w_inundation=abc'
    )
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 400001, data: null })
  })

  it('权重和≠1 ⇒ 400 + code 400001（校验先于查库，无库也能判）', async () => {
    const res = await request(app.getHttpServer()).get(
      '/nest-api/site-suitability/map?w_inundation=0.6&w_terrain=0.2&w_land=0.2&w_access=0.2&w_demand=0.2'
    )
    expect(res.status).toBe(400)
    expect(res.body.code).toBe(400001)
  })

  it('阳性对照：合法入参不得被判 400001', async () => {
    const res = await request(app.getHttpServer()).get(
      '/nest-api/site-suitability/map?resolution=0.5'
    )
    expect(res.body.code).not.toBe(400001)
  })

  // 出参契约：需真库（CI 由 suitability-cells-fixture.sql 提供 7 格；本地为全量面）。
  // 钉两件：① 端点真能出数（此前 CI 恒 5xx）；② properties.id 是 number ——
  // 2026-10-01 生产事故（bigint 经 pg 驱动变字符串 ⇒ 前端 zod 校验失败、页面恒"暂无数据"）
  // 的 HTTP 层回归；resolution=0.5 走聚合，避免全量 14 万格把响应撑到 28MB。
  it.skipIf(!withDb)('连真库：200 + FeatureCollection 非空 + properties.id 是 number', async () => {
    const res = await request(app.getHttpServer()).get(
      '/nest-api/site-suitability/map?resolution=0.5'
    )
    expect(res.status).toBe(200)
    // 出参经 envelope.interceptor 包一层 { code, error, data } —— 读 data，不读顶层
    expect(res.body.data.type).toBe('FeatureCollection')
    expect(res.body.data.features.length).toBeGreaterThan(0)
    expect(typeof res.body.data.features[0].properties.id).toBe('number')
  })
})
