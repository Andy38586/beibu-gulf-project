import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'
import { DbService } from '../src/infra/db/db.service'

// favorites e2e：连真实开发库，用例移植 Express favoritesController.test.js 语义。
// 测试用户 __t3_fav 前缀（auth 走真实注册拿 cookie），favorites 随用户级联清理
const VALID_BODY = {
  itemType: 'xiaoqu',
  itemId: '__t3_e2e_B1',
  name: '小区A',
  lng: 108.5,
  lat: 21.7,
}

function authCookie(res: { headers: Record<string, unknown> }): string {
  const raw = (res.headers['set-cookie'] as string[]).find((c) => c.startsWith('auth_token='))
  expect(raw).toBeTruthy()
  return (raw as string).split(';')[0]
}

describe('favorites e2e（连真库）', () => {
  let app: INestApplication
  let db: DbService
  let cookieU1: string

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
      "DELETE FROM favorites WHERE user_id IN (SELECT id FROM users WHERE substr(username, 1, 8) = '__t3_fav')"
    )
    await db.query("DELETE FROM users WHERE substr(username, 1, 8) = '__t3_fav'")
    const res = await register('__t3_fav_e2e_u1').expect(201)
    cookieU1 = authCookie(res)
    await register('__t3_fav_e2e_u2').expect(201)
  })

  afterAll(async () => {
    await db.query(
      "DELETE FROM favorites WHERE user_id IN (SELECT id FROM users WHERE substr(username, 1, 8) = '__t3_fav')"
    )
    await db.query("DELETE FROM users WHERE substr(username, 1, 8) = '__t3_fav'")
    await app.close()
  })

  it('未登录 → 401 {code:401001, error:"未提供认证令牌"}（全路由需登录）', async () => {
    const base = '/nest-api/favorites'
    await request(app.getHttpServer()).get(base).expect(401)
    await request(app.getHttpServer()).post(base).send(VALID_BODY).expect(401)
    await request(app.getHttpServer()).delete(`${base}/xiaoqu/x`).expect(401)
  })

  it('list → 200 信封 data 为项数组（初始为空）', async () => {
    const res = await request(app.getHttpServer())
      .get('/nest-api/favorites')
      .set('Cookie', cookieU1)
      .expect(200)
    expect(res.body).toEqual({ code: 200, data: [] })
  })

  it('add 合法入参 → {favorite 完整视图, existed:false}', async () => {
    const res = await request(app.getHttpServer())
      .post('/nest-api/favorites')
      .set('Cookie', cookieU1)
      .send(VALID_BODY)
      .expect(200)
    expect(res.body).toEqual({
      code: 200,
      data: {
        favorite: {
          id: expect.any(String),
          userId: expect.any(String),
          itemType: 'xiaoqu',
          itemId: VALID_BODY.itemId,
          name: '小区A',
          lng: 108.5,
          lat: 21.7,
          snapshot: null,
          savedAt: expect.any(String),
        },
        existed: false,
      },
    })
  })

  it('幂等：同键重复 add → existed:true 且 id 不变（不重复落库）', async () => {
    const first = await request(app.getHttpServer())
      .post('/nest-api/favorites')
      .set('Cookie', cookieU1)
      .send(VALID_BODY)
      .expect(200)
    const second = await request(app.getHttpServer())
      .post('/nest-api/favorites')
      .set('Cookie', cookieU1)
      .send(VALID_BODY)
      .expect(200)
    expect(second.body.data.existed).toBe(true)
    expect(second.body.data.favorite.id).toBe(first.body.data.favorite.id)
  })

  it.each([
    ['itemType 非白名单', { ...VALID_BODY, itemType: 'poi' }, 'itemType 无效（xiaoqu | facility）'],
    ['缺 itemId', { ...VALID_BODY, itemId: '' }, 'itemId 必填且为字符串'],
    ['缺 name', { ...VALID_BODY, name: '' }, 'name 必填且为字符串'],
    ['lng 非数值', { ...VALID_BODY, lng: 'abc' }, 'lng/lat 必须为有限数值'],
  ])('%s → 400 {code:400001, 文案逐字节对齐}', async (_label, body, message) => {
    const res = await request(app.getHttpServer())
      .post('/nest-api/favorites')
      .set('Cookie', cookieU1)
      .send(body)
      .expect(400)
    expect(res.body).toEqual({ code: 400001, error: message, data: null })
  })

  it('remove 合法 → {removed:true}；键不存在 → {removed:false}', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/nest-api/favorites/xiaoqu/${VALID_BODY.itemId}`)
      .set('Cookie', cookieU1)
      .expect(200)
    expect(res.body).toEqual({ code: 200, data: { removed: true } })
    const again = await request(app.getHttpServer())
      .delete(`/nest-api/favorites/xiaoqu/${VALID_BODY.itemId}`)
      .set('Cookie', cookieU1)
      .expect(200)
    expect(again.body).toEqual({ code: 200, data: { removed: false } })
  })

  it('remove itemType 非白名单 → 400', async () => {
    const res = await request(app.getHttpServer())
      .delete('/nest-api/favorites/poi/B1')
      .set('Cookie', cookieU1)
      .expect(400)
    expect(res.body).toEqual({
      code: 400001,
      error: 'itemType 无效（xiaoqu | facility）',
      data: null,
    })
  })

  it('用户隔离：u2 的收藏不出现在 u1 列表（跨用户不可见）', async () => {
    const loginU2 = await request(app.getHttpServer())
      .post('/nest-api/auth/login')
      .send({ username: '__t3_fav_e2e_u2', password: 'Abcdef1' })
      .expect(200)
    const cookieU2 = authCookie(loginU2)
    await request(app.getHttpServer())
      .post('/nest-api/favorites')
      .set('Cookie', cookieU2)
      .send(VALID_BODY)
      .expect(200)
    const u1List = await request(app.getHttpServer())
      .get('/nest-api/favorites')
      .set('Cookie', cookieU1)
      .expect(200)
    expect(u1List.body.data).toHaveLength(0)
    const u2List = await request(app.getHttpServer())
      .get('/nest-api/favorites')
      .set('Cookie', cookieU2)
      .expect(200)
    expect(u2List.body.data).toHaveLength(1)
  })
})
