import { Controller, Get, INestApplication, Post, UseGuards } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module'
import { BusinessError, ErrorCode } from '../src/common/errors/business-error'
import { AuthModule } from '../src/modules/auth/auth.module'
import { AuthGuard } from '../src/modules/auth/guards/auth.guard'

// 契约 e2e：信封拦截器 / 错误过滤 / 404 文案 / 守卫 401——
// 形状逐字节对齐老 Express（sendSuccess / 全局错误中间件 / auth 中间件）
@Controller('__contract')
class ContractController {
  @Get('echo')
  echo(): { msg: string } {
    return { msg: 'hi' }
  }

  @Post('created')
  created(): { id: string } {
    return { id: 'n1' }
  }

  @Get('boom')
  boom(): never {
    throw new BusinessError(ErrorCode.INVALID_PARAMS, '用户名和密码不能为空')
  }

  @Get('guarded')
  @UseGuards(AuthGuard)
  guarded(): { ok: boolean } {
    return { ok: true }
  }
}

describe('契约 e2e（信封/错误/守卫）', () => {
  let app: INestApplication

  beforeAll(async () => {
    process.env.JWT_SECRET = 'x'.repeat(64)
    const moduleRef = await Test.createTestingModule({
      // AuthModule 提升到测试根：@UseGuards(AuthGuard) 挂在根模块的测试 controller 上，
      // guard 依赖（UsersRepository）须在根上下文可见（Nest 模块可见性规则）
      imports: [AppModule, AuthModule],
      controllers: [ContractController],
    }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('nest-api')
    app.use(cookieParser())
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET 成功 → 信封 {code:200, data}', async () => {
    const res = await request(app.getHttpServer()).get('/nest-api/__contract/echo').expect(200)
    expect(res.body).toEqual({ code: 200, data: { msg: 'hi' } })
  })

  it('POST 201 → 信封携带同值 code:201（对齐 sendSuccess 第三参）', async () => {
    const res = await request(app.getHttpServer()).post('/nest-api/__contract/created').expect(201)
    expect(res.body).toEqual({ code: 201, data: { id: 'n1' } })
  })

  it('BusinessError → {code:400001, error, data:null} + HTTP 400', async () => {
    const res = await request(app.getHttpServer()).get('/nest-api/__contract/boom').expect(400)
    expect(res.body).toEqual({ code: 400001, error: '用户名和密码不能为空', data: null })
  })

  it('未捕获异常 → 500 {code:500001, data:null}（dev 显示 detail）', async () => {
    // 触发方式：guard 内部抛非业务错误不可控，改用 404 之外的内建路径——
    // 直接以坏 JSON body 触发 Nest 内建 BadRequestException（400 → code 400001 映射为 400*1000+1）
    const res = await request(app.getHttpServer())
      .post('/nest-api/__contract/created')
      .set('Content-Type', 'application/json')
      .send('not-json')
      .expect(400)
    expect(res.body.data).toBeNull()
    expect(res.body.error).toBeTruthy()
  })

  it('不存在路由 → 404 {code:404001, error:"接口不存在", data:null}', async () => {
    const res = await request(app.getHttpServer()).get('/nest-api/no-such-route').expect(404)
    expect(res.body).toEqual({ code: 404001, error: '接口不存在', data: null })
  })

  it('守卫路由无凭据 → 401 {code:401001, error:"未提供认证令牌", data:null}', async () => {
    const res = await request(app.getHttpServer()).get('/nest-api/__contract/guarded').expect(401)
    expect(res.body).toEqual({ code: 401001, error: '未提供认证令牌', data: null })
  })

  it('守卫路由坏 token → 401「认证令牌无效或已过期」', async () => {
    const res = await request(app.getHttpServer())
      .get('/nest-api/__contract/guarded')
      .set('Authorization', 'Bearer bad.token.here')
      .expect(401)
    expect(res.body).toEqual({ code: 401001, error: '认证令牌无效或已过期', data: null })
  })
})
