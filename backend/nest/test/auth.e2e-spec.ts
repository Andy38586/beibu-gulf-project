import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'
import { DbService } from '../src/infra/db/db.service'

// auth e2e：连真实开发库 v3_dev（docker-compose.v3.yml）。
// 测试数据一律 __t3_ 前缀，beforeAll/afterAll 双清理（手册 §五 测试隔离约定）
const PREFIX_LEN = 5 // '__t3_'

function authCookie(res: { headers: Record<string, unknown> }): string {
  const setCookie = res.headers['set-cookie'] as string[]
  expect(setCookie).toBeTruthy()
  const raw = setCookie.find((c) => c.startsWith('auth_token='))
  expect(raw, '应下发 auth_token cookie').toBeTruthy()
  return (raw as string).split(';')[0]
}

describe('auth e2e（连真库）', () => {
  let app: INestApplication
  let db: DbService

  beforeAll(async () => {
    process.env.JWT_SECRET = 'x'.repeat(64)
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('nest-api')
    app.use(cookieParser())
    await app.init()
    db = moduleRef.get(DbService)
    await db.query("DELETE FROM users WHERE substr(username, 1, $1) = '__t3_'", [PREFIX_LEN])
  })

  afterAll(async () => {
    await db.query("DELETE FROM users WHERE substr(username, 1, $1) = '__t3_'", [PREFIX_LEN])
    await app.close()
  })

  it('注册成功 → 201 信封 {code:201, user 视图} + HttpOnly cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/nest-api/auth/register')
      .send({ username: '__t3_register', password: 'Abcdef1' })
      .expect(201)
    expect(res.body).toEqual({
      code: 201,
      data: {
        user: {
          id: expect.any(String),
          username: '__t3_register',
          createdAt: expect.any(String),
          tokenVersion: 0,
        },
      },
    })
    const setCookies = res.headers['set-cookie']
    const raw = Array.isArray(setCookies)
      ? setCookies.find((c) => c.startsWith('auth_token='))
      : undefined
    expect(raw).toContain('HttpOnly')
    expect(raw).toContain('SameSite=Strict')
    expect(raw).toContain('Max-Age=604800')
    // 库内落库校验：密码为 bcrypt 哈希而非明文
    const row = await db.query<{ password: string }>(
      "SELECT password FROM users WHERE substr(username, 1, $1) = '__t3_' AND username = '__t3_register'",
      [PREFIX_LEN]
    )
    expect(row.rows[0].password).toMatch(/^\$2[aby]\$/)
  })

  it('用户名重复 → 409 {code:409001, error:"用户名已存在"}', async () => {
    const res = await request(app.getHttpServer())
      .post('/nest-api/auth/register')
      .send({ username: '__t3_register', password: 'Abcdef1' })
      .expect(409)
    expect(res.body).toEqual({ code: 409001, error: '用户名已存在', data: null })
  })

  it('注册参数非法 → 400 文案逐字节对齐（密码缺强度示例）', async () => {
    const res = await request(app.getHttpServer())
      .post('/nest-api/auth/register')
      .send({ username: '__t3_weak', password: 'abcdef' })
      .expect(400)
    expect(res.body).toEqual({ code: 400001, error: '密码必须包含大小写字母和数字', data: null })
  })

  it('登录成功 → 200 {code:200, user:{id,username,createdAt}} + cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/nest-api/auth/login')
      .send({ username: '__t3_register', password: 'Abcdef1' })
      .expect(200)
    expect(res.body).toEqual({
      code: 200,
      data: {
        user: {
          id: expect.any(String),
          username: '__t3_register',
          createdAt: expect.any(String),
        },
      },
    })
    expect(authCookie(res)).toMatch(/^auth_token=/)
  })

  it('密码错误 → 401 {code:401003, error:"密码错误"}', async () => {
    const res = await request(app.getHttpServer())
      .post('/nest-api/auth/login')
      .send({ username: '__t3_register', password: 'WrongPass1' })
      .expect(401)
    expect(res.body).toEqual({ code: 401003, error: '密码错误', data: null })
  })

  it('账号不存在 → 401 {code:401002, error:"账号不存在，请先注册"}', async () => {
    const res = await request(app.getHttpServer())
      .post('/nest-api/auth/login')
      .send({ username: '__t3_ghost', password: 'Abcdef1' })
      .expect(401)
    expect(res.body).toEqual({ code: 401002, error: '账号不存在，请先注册', data: null })
  })

  it('占位密码账号（T2.x 迁移语义）登录 → 401 {code:401003}，不 500', async () => {
    await db.query(
      "INSERT INTO users (id, username, password, token_version, created_at) VALUES ('__t3_placeholder', '__t3_placeholder', 'v3-migrated', 0, '2026-09-01T00:00:00.000Z')"
    )
    const res = await request(app.getHttpServer())
      .post('/nest-api/auth/login')
      .send({ username: '__t3_placeholder', password: 'Abcdef1' })
      .expect(401)
    expect(res.body).toEqual({ code: 401003, error: '密码错误', data: null })
  })

  it('me 未带 Cookie → 401 {code:401001, error:"未提供认证令牌"}', async () => {
    const res = await request(app.getHttpServer()).get('/nest-api/auth/me').expect(401)
    expect(res.body).toEqual({ code: 401001, error: '未提供认证令牌', data: null })
  })

  it('me 带 Cookie → 200 {user:{id,username}} + Cache-Control: no-store', async () => {
    const login = await request(app.getHttpServer())
      .post('/nest-api/auth/login')
      .send({ username: '__t3_register', password: 'Abcdef1' })
      .expect(200)
    const cookie = authCookie(login)
    const res = await request(app.getHttpServer())
      .get('/nest-api/auth/me')
      .set('Cookie', cookie)
      .expect(200)
    expect(res.body).toEqual({
      code: 200,
      data: { user: { id: expect.any(String), username: '__t3_register' } },
    })
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('登出 → 200 {message:"登出成功"} + 清 cookie；旧 token 随 tokenVersion 吊销失效', async () => {
    const login = await request(app.getHttpServer())
      .post('/nest-api/auth/login')
      .send({ username: '__t3_register', password: 'Abcdef1' })
      .expect(200)
    const cookie = authCookie(login)
    const res = await request(app.getHttpServer())
      .post('/nest-api/auth/logout')
      .set('Cookie', cookie)
      .expect(200)
    expect(res.body).toEqual({ code: 200, data: { message: '登出成功' } })
    const setCookies = res.headers['set-cookie']
    const cleared = Array.isArray(setCookies)
      ? setCookies.find((c) => c.startsWith('auth_token='))
      : undefined
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970')
    // 旧 token 已被吊销（tokenVersion 自增）→ 401 专属文案
    const me = await request(app.getHttpServer())
      .get('/nest-api/auth/me')
      .set('Cookie', cookie)
      .expect(401)
    expect(me.body).toEqual({ code: 401001, error: '令牌已失效，请重新登录', data: null })
  })

  it('登录限流 50/15min：首个 429 恰在第 51 次请求，文案对齐；注册桶独立不受牵连', async () => {
    // 本 describe 登录类用例已消耗 login 桶 6 次（成功 3 + 失败 3）；
    // 新增登录类用例时同步维护 PRIOR 值，边界断言会兜底防漂移
    const PRIOR_LOGIN_HITS = 6
    let hits = PRIOR_LOGIN_HITS
    let throttled: { body: unknown } | null = null
    for (let i = 0; hits < 60; i++) {
      const res = await request(app.getHttpServer())
        .post('/nest-api/auth/login')
        .send({ username: `__t3_ghost_${i}`, password: 'Abcdef1' })
      hits++
      if (res.status === 429) {
        throttled = { body: res.body }
        break
      }
      expect(res.status).toBe(401)
    }
    expect(hits).toBe(51) // 50/15min：50 次放行，第 51 次拦截
    expect(throttled!.body).toEqual({ error: '登录尝试过于频繁，请 15 分钟后再试' })
    // register 桶独立：login 桶满后注册仍正常（不与 login 桶合并计数，对齐 Express 双 limiter）
    await request(app.getHttpServer())
      .post('/nest-api/auth/register')
      .send({ username: '__t3_after_throttle', password: 'Abcdef1' })
      .expect(201)
  }, 60000)
})
