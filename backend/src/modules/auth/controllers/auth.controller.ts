import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import type { Request, Response } from 'express'

import { DtoPipe } from '../../../common/pipes/dto.pipe'
import { LoginBody, RegisterBody } from '../dto/auth.dto'
import { AuthGuard } from '../guards/auth.guard'
import type { LoginUserView, RegisterUserView } from '../services/auth.service'
import { AuthService } from '../services/auth.service'

// 公共 cookie 设置，register/login 复用（逐字节对齐 Express setAuthCookie）：
// Secure 由实际连接协议决定（含 nginx 透传的 X-Forwarded-Proto），不能按 NODE_ENV 判断——
// 生产 HTTP 下 Secure cookie 会被浏览器拒绝保存，登录即失效
function setAuthCookie(res: Response, token: string, req: Request): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https'
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天
  })
}

// 限流对齐 Express：login/register 各自独立桶（50/15min）+ 全局桶（1000/15min）。
// @SkipThrottle 只关掉本路由不需要的命名桶：login 路由 = global + login 两桶计数
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST 默认 201，对齐 Express sendSuccess(res, {user}, 201)；
  // 桶归属：register 路由只关 login 桶 → 全局 1000 + 注册 50 两桶独立计数（对齐 Express 双 limiter）
  @Post('register')
  @HttpCode(201)
  @SkipThrottle({ login: true })
  async register(
    @Body(new DtoPipe(RegisterBody.parse)) body: RegisterBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ user: RegisterUserView }> {
    const { user, token } = await this.authService.register(body)
    setAuthCookie(res, token, req)
    return { user }
  }

  @Post('login')
  @HttpCode(200)
  @SkipThrottle({ register: true })
  async login(
    @Body(new DtoPipe(LoginBody.parse)) body: LoginBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ user: LoginUserView }> {
    const { user, token } = await this.authService.login(body)
    setAuthCookie(res, token, req)
    return { user }
  }

  @Post('logout')
  @HttpCode(200)
  @SkipThrottle({ login: true, register: true })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ message: string }> {
    const token = req.cookies?.auth_token as string | undefined
    await this.authService.logout(token)
    res.clearCookie('auth_token')
    return { message: '登出成功' }
  }

  // 认证响应禁止缓存：ETag 304 会让前端 fetch 误判登出（对齐 Express me 的 no-store）
  @Get('me')
  @SkipThrottle({ login: true, register: true })
  @UseGuards(AuthGuard)
  me(
    @Req() req: Request & { user?: { id: string; username: string } },
    @Res({ passthrough: true }) res: Response
  ): { user: unknown } {
    res.set('Cache-Control', 'no-store')
    return { user: req.user }
  }
}
