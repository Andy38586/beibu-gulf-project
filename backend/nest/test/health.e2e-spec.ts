import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'

// 健康端点契约测试：信封形状 {code,data} 与老 Express /api/health 逐字节一致
describe('GET /nest-api/health', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('nest-api')
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('返回统一信封 {code:200, data:{status:"ok"}}', async () => {
    const res = await request(app.getHttpServer()).get('/nest-api/health').expect(200)
    expect(res.body).toEqual({ code: 200, data: { status: 'ok' } })
  })
})

// readiness 探针：库不可达路径的确定性测试——PG_PORT=1 指向必然拒绝连接的端口，
// 不依赖外部 Docker 状态（库可达 → 200 ready 的正向路径在 T0.1 PostGIS 复活后补验）
describe('GET /nest-api/health/ready（库不可达）', () => {
  let app: INestApplication

  beforeAll(async () => {
    process.env.PG_HOST = '127.0.0.1'
    process.env.PG_PORT = '1'
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('nest-api')
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('返回 503 degraded（裸 JSON {status,checks}，对齐老 Express readiness 形状）', async () => {
    const res = await request(app.getHttpServer()).get('/nest-api/health/ready').expect(503)
    expect(res.body).toEqual({ status: 'degraded', checks: { db: false } })
  })
})
