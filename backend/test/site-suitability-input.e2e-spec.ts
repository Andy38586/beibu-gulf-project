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
// 门控：前两条不依赖真库（compute 在校验通过后才查库）；第三条若带
// V3_INTEGRATION_DB 则本地真库应 200，CI 无 suitability_cells 时以 5xx 收场也合法——
// 它只负责证明"400001 不是万能回包"。
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
    if (withDb) expect(res.status).toBe(200)
  })
})
