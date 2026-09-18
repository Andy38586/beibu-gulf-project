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

// 镜像身份自证端点（2026-09-18 CI 审计 D-01）。
//
// 存在的理由是一条真实事故：CI deploy 阶段三原以 `ssh docker inspect` 校镜像身份，
// SSH 不可用时**降级为「HTTP 200 即成功」**——而旧容器同样返回 200，
// 于是「部署成功」退化成「服务活着」（run#183 实证：20 秒假成功）。
// 本端点给部署链一个**不依赖 SSH** 的身份证据源。
describe('GET /nest-api/health/version（镜像身份自证）', () => {
  let app: INestApplication

  beforeAll(async () => {
    process.env.APP_IMAGE_TAG = 'nest-183'
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('nest-api')
    await app.init()
  })

  afterAll(async () => {
    await app.close()
    delete process.env.APP_IMAGE_TAG
  })

  it('回显 APP_IMAGE_TAG（部署链据此判定线上跑的哪个 tag）', async () => {
    const res = await request(app.getHttpServer()).get('/nest-api/health/version').expect(200)
    expect(res.body).toEqual({ status: 'ok', imageTag: 'nest-183' })
  })

  // 契约关键点：未注入时必须报 unknown，**不得**回退成空串或 200 之外的形状——
  // 部署链把「非本次 IMAGE_TAG」一律视为身份未证实，unknown 会被正确拒绝。
  it('未注入 APP_IMAGE_TAG 时回显 unknown（不得伪装成已知身份）', async () => {
    const saved = process.env.APP_IMAGE_TAG
    delete process.env.APP_IMAGE_TAG
    const res = await request(app.getHttpServer()).get('/nest-api/health/version').expect(200)
    expect(res.body).toEqual({ status: 'ok', imageTag: 'unknown' })
    process.env.APP_IMAGE_TAG = saved
  })

  // 防环境变量反射：任意形状的值（含 shell 元字符、超长串）只能得到 unknown
  it('非法形状的 APP_IMAGE_TAG 一律折叠为 unknown（不回显任意环境变量）', async () => {
    const saved = process.env.APP_IMAGE_TAG
    for (const bad of ['a b', 'x;rm -rf /', 'y$(whoami)', 'z'.repeat(200)]) {
      process.env.APP_IMAGE_TAG = bad
      const res = await request(app.getHttpServer()).get('/nest-api/health/version').expect(200)
      expect(res.body.imageTag).toBe('unknown')
    }
    process.env.APP_IMAGE_TAG = saved
  })
})
