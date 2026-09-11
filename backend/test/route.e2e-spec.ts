import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'

// route e2e（审查 M-3 回归 + 审查报告"未能确认项#4"补口）。
// route 域此前未挂 @SkipThrottle：@nestjs/throttler 命名桶默认套用**所有**路由，
// 公开只读的 /route/path 被 login 桶（50/15min）误伤，15 分钟 51 次即全线 429
//（重演 flood 域事故，见 flood.controller 注释自证）。
// 限流归属断言不依赖真库：无库时请求以 5xx 收场但计数照常，429 与否足以判定桶归属；
// 寻路契约冒烟属真库范畴，V3_INTEGRATION_DB 门控（site-analysis e2e 同款）。
const withDb = process.env.V3_INTEGRATION_DB !== undefined

describe('route e2e — 限流桶归属（无库可跑）', () => {
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

  it('公开高频只读接口 60 连发无一 429（不落入 login/register 50 桶）', async () => {
    for (let i = 0; i < 60; i++) {
      const res = await request(app.getHttpServer()).get(
        '/nest-api/route/path?fromLng=108.6&fromLat=21.6&toLng=108.7&toLat=21.7&mode=distance'
      )
      // 第 51 发起命中即 login 桶误伤（global 桶 1000/15min 远未触顶）
      expect(res.status).not.toBe(429)
    }
  })
})

describe.skipIf(!withDb)('route e2e（连真库 PostGIS）', () => {
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

  it('GET /route/path 正常寻路 → found:true 契约', async () => {
    const res = await request(app.getHttpServer()).get(
      '/nest-api/route/path?fromLng=108.6&fromLat=21.6&toLng=108.7&toLat=21.7&mode=distance'
    )
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ code: 200 })
    expect(res.body.data).toMatchObject({ found: expect.any(Boolean) })
  })

  it('参数越界 → 400001 业务错误信封', async () => {
    const res = await request(app.getHttpServer()).get(
      '/nest-api/route/path?fromLng=999&fromLat=21.6&toLng=108.7&toLat=21.7'
    )
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 400001 })
  })
})
