import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import type { Request, Response } from 'express'

import { DtoPipe } from '../../../common/pipes/dto.pipe'
import { ConfigService } from '../../../infra/config/config.service'
import { LoginBody, RegisterBody } from '../dto/auth.dto'
import { AuthGuard } from '../guards/auth.guard'
import type { AuthenticatedRequest, AuthUserView } from '../guards/auth.guard'
import type { LoginUserView, RegisterUserView } from '../services/auth.service'
import { AuthService } from '../services/auth.service'

// 公共 cookie 设置，register/login 复用（逐字节对齐 Express setAuthCookie）：
// Secure 由显式配置 `ConfigService.cookieSecure` 决定（生产默认 true），**不再**由
// `req.secure || x-forwarded-proto` 推定——无证书部署下该推定恒 false 而链路"健康"，
// 令牌明文传输（z054）。
function setAuthCookie(res: Response, token: string, secure: boolean): void {
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 天
  })
}

// 限流对齐 Express：login/register 各自独立桶（50/15min）+ 全局桶（1000/15min）。
// @SkipThrottle 只关掉本路由不需要的命名桶：login 路由 = global + login 两桶计数
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService
  ) {}

  // POST 默认 201，对齐 Express sendSuccess(res, {user}, 201)；
  // 桶归属：register 路由只关 login 桶 → 全局 1000 + 注册 50 两桶独立计数（对齐 Express 双 limiter）
  @Post('register')
  @HttpCode(201)
  @SkipThrottle({ login: true })
  async register(
    @Body(new DtoPipe(RegisterBody.parse)) body: RegisterBody,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ user: RegisterUserView }> {
    const { user, token } = await this.authService.register(body)
    setAuthCookie(res, token, this.config.cookieSecure)
    return { user }
  }

  @Post('login')
  @HttpCode(200)
  @SkipThrottle({ register: true })
  async login(
    @Body(new DtoPipe(LoginBody.parse)) body: LoginBody,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ user: LoginUserView }> {
    const { user, token } = await this.authService.login(body)
    setAuthCookie(res, token, this.config.cookieSecure)
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
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response
  ): { user: AuthUserView } {
    res.set('Cache-Control', 'no-store')
    return { user: req.user }
  }
}
