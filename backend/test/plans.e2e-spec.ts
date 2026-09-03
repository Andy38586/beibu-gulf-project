import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'
import { DbService } from '../src/infra/db/db.service'

// 真库套件：需 v3_dev 库（docker-compose.v3.yml）。无库环境（CI/本机未起 PG）整体跳过，
// 避免 ECONNREFUSED 噪音；联调时 export V3_INTEGRATION_DB=1 恢复全量
const withDb = process.env.V3_INTEGRATION_DB !== undefined

// plans e2e：连真实开发库，用例语义移植 Express plansController.test.js（17 用例）。
// 测试用户 __t3_plan 前缀，plans 随用户级联清理
const VALID_BODY = {
  name: '钦州湾方案A',
  selectedKeys: ['hospital'],
  typeSettings: { defaultRadius: 3000 },
  weights: { hospital: 1.2 },
}

function authCookie(res: { headers: Record<string, unknown> }): string {
  const raw = (res.headers['set-cookie'] as string[]).find((c) => c.startsWith('auth_token='))
  expect(raw).toBeTruthy()
  return (raw as string).split(';')[0]
}

describe.skipIf(!withDb)('plans e2e（连真库）', () => {
  let app: INestApplication
  let db: DbService
  let cookieU1: string
  let cookieU2: string

  const register = (username: string) =>
    request(app.getHttpServer())
      .post('/nest-api/auth/register')
      .send({ username, password: 'Abcdef1' })

  beforeAll(async () => {
    process.env.JWT_SECRET = 'x'.repeat(64)
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('nest-api')
    app.use(cookieParser())
    await app.init()
    db = moduleRef.get(DbService)
    await db.query(
      "DELETE FROM plans WHERE user_id IN (SELECT id FROM users WHERE substr(username, 1, 9) = '__t3_plan')"
    )
    await db.query("DELETE FROM users WHERE substr(username, 1, 9) = '__t3_plan'")
    cookieU1 = authCookie(await register('__t3_plan_e2e_u1').expect(201))
    cookieU2 = authCookie(await register('__t3_plan_e2e_u2').expect(201))
  })

  afterAll(async () => {
    await db.query(
      "DELETE FROM plans WHERE user_id IN (SELECT id FROM users WHERE substr(username, 1, 9) = '__t3_plan')"
    )
    await db.query("DELETE FROM users WHERE substr(username, 1, 9) = '__t3_plan'")
    await app.close()
  })

  it('list → 200 data 数组（初始空）；未登录 → 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/nest-api/plans')
      .set('Cookie', cookieU1)
      .expect(200)
    expect(res.body).toEqual({ code: 200, data: [] })
    await request(app.getHttpServer()).get('/nest-api/plans').expect(401)
  })

  it('create → 201 完整视图', async () => {
    const res = await request(app.getHttpServer())
      .post('/nest-api/plans')
      .set('Cookie', cookieU1)
      .send(VALID_BODY)
      .expect(201)
    expect(res.body).toEqual({
      code: 201,
      data: {
        id: expect.any(String),
        userId: expect.any(String),
        name: '钦州湾方案A',
        selectedKeys: ['hospital'],
        typeSettings: { defaultRadius: 3000 },
        weights: { hospital: 1.2 },
        savedXiaoqu: [],
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    })
  })

  it('缺 name/selectedKeys → 400 文案逐字节', async () => {
    const res = await request(app.getHttpServer())
      .post('/nest-api/plans')
      .set('Cookie', cookieU1)
      .send({ name: 'x' })
      .expect(400)
    expect(res.body).toEqual({
      code: 400001,
      error: '缺少必要字段: name, selectedKeys',
      data: null,
    })
  })

  it('名称含非法字符 → 400 文案逐字节', async () => {
    const res = await request(app.getHttpServer())
      .post('/nest-api/plans')
      .set('Cookie', cookieU1)
      .send({ name: '方案<script>', selectedKeys: ['park'] })
      .expect(400)
    expect(res.body).toEqual({
      code: 400001,
      error: '方案名称只能包含中文、字母、数字、下划线、连字符和空格，且长度不超过 50 字符',
      data: null,
    })
  })

  it('重名 → 409 {code:409002}', async () => {
    const res = await request(app.getHttpServer())
      .post('/nest-api/plans')
      .set('Cookie', cookieU1)
      .send(VALID_BODY)
      .expect(409)
    expect(res.body).toEqual({ code: 409002, error: '方案名称已存在', data: null })
  })

  it('getOne 命中 200；不存在 404；他人方案 403', async () => {
    const created = await request(app.getHttpServer())
      .post('/nest-api/plans')
      .set('Cookie', cookieU1)
      .send({ name: '查询单条方案', selectedKeys: ['park'] })
      .expect(201)
    const pid = created.body.data.id as string
    const got = await request(app.getHttpServer())
      .get(`/nest-api/plans/${pid}`)
      .set('Cookie', cookieU1)
      .expect(200)
    expect(got.body.data.id).toBe(pid)
    await request(app.getHttpServer())
      .get('/nest-api/plans/__t3_no_such')
      .set('Cookie', cookieU1)
      .expect(404)
      .then((r) => expect(r.body).toEqual({ code: 404001, error: '方案不存在', data: null }))
    await request(app.getHttpServer())
      .get(`/nest-api/plans/${pid}`)
      .set('Cookie', cookieU2)
      .expect(403)
      .then((r) => expect(r.body).toEqual({ code: 403001, error: '无权访问该方案', data: null }))
  })

  it('update 属主改名 200；改名重名 409', async () => {
    const a = await request(app.getHttpServer())
      .post('/nest-api/plans')
      .set('Cookie', cookieU1)
      .send({ name: '更新目标方案', selectedKeys: ['park'] })
      .expect(201)
    // 重名参照方案（供下方改名撞名 409 用，无需持有响应）
    await request(app.getHttpServer())
      .post('/nest-api/plans')
      .set('Cookie', cookieU1)
      .send({ name: '重名参照方案', selectedKeys: ['park'] })
      .expect(201)
    const updated = await request(app.getHttpServer())
      .put(`/nest-api/plans/${a.body.data.id}`)
      .set('Cookie', cookieU1)
      .send({ name: '更新后名字', weights: { park: 0.8 } })
      .expect(200)
    expect(updated.body.data).toMatchObject({ name: '更新后名字', weights: { park: 0.8 } })
    expect(updated.body.data.selectedKeys).toEqual(['park']) // 未传字段保留
    const dup = await request(app.getHttpServer())
      .put(`/nest-api/plans/${a.body.data.id}`)
      .set('Cookie', cookieU1)
      .send({ name: '重名参照方案' })
      .expect(409)
    expect(dup.body).toEqual({ code: 409002, error: '方案名称已存在', data: null })
  })

  it('delete 属主 → 204 无响应体；再删 → 404', async () => {
    const created = await request(app.getHttpServer())
      .post('/nest-api/plans')
      .set('Cookie', cookieU1)
      .send({ name: '待删除方案', selectedKeys: ['park'] })
      .expect(201)
    const pid = created.body.data.id as string
    const del = await request(app.getHttpServer())
      .delete(`/nest-api/plans/${pid}`)
      .set('Cookie', cookieU1)
      .expect(204)
    expect(del.text).toBe('')
    await request(app.getHttpServer())
      .delete(`/nest-api/plans/${pid}`)
      .set('Cookie', cookieU1)
      .expect(404)
      .then((r) => expect(r.body).toEqual({ code: 404001, error: '方案不存在', data: null }))
  })

  it('saveXiaoqu → 200 保存小区；缺小区 id → 400；removeXiaoqu → 200 移除；他人方案 → 403', async () => {
    const created = await request(app.getHttpServer())
      .post('/nest-api/plans')
      .set('Cookie', cookieU1)
      .send({ name: '小区保存方案', selectedKeys: ['park'] })
      .expect(201)
    const pid = created.body.data.id as string
    const saved = await request(app.getHttpServer())
      .post(`/nest-api/plans/${pid}/xiaoqu`)
      .set('Cookie', cookieU1)
      .send({ xiaoqu: { id: 'x1', name: '小区A', score: 88 } })
      .expect(200)
    expect(saved.body.data.savedXiaoqu).toHaveLength(1)
    const missing = await request(app.getHttpServer())
      .post(`/nest-api/plans/${pid}/xiaoqu`)
      .set('Cookie', cookieU1)
      .send({ xiaoqu: {} })
      .expect(400)
    expect(missing.body).toEqual({ code: 400001, error: '缺少小区信息', data: null })
    const removed = await request(app.getHttpServer())
      .delete(`/nest-api/plans/${pid}/xiaoqu/x1`)
      .set('Cookie', cookieU1)
      .expect(200)
    expect(removed.body.data.savedXiaoqu).toEqual([])
    await request(app.getHttpServer())
      .post(`/nest-api/plans/${pid}/xiaoqu`)
      .set('Cookie', cookieU2)
      .send({ xiaoqu: { id: 'x2' } })
      .expect(403)
      .then((r) => expect(r.body).toEqual({ code: 403001, error: '无权修改该方案', data: null }))
  })
})
