import { type ExecutionContext, Injectable } from '@nestjs/common'
import type { ThrottlerLimitDetail } from '@nestjs/throttler'
import { ThrottlerGuard } from '@nestjs/throttler'
import type { Request } from 'express'

// 限流守卫全局挂载（APP_GUARD）；若只注册 ThrottlerModule 配置而不挂守卫，限流会空转。
// 429 文案按路由对齐 Express express-rate-limit 的 message（裸 {error} 形状，
// 由 BusinessErrorFilter 透传）
@Injectable()
export class EnvelopeThrottlerGuard extends ThrottlerGuard {
  protected override async getErrorMessage(
    context: ExecutionContext,
    _throttlerLimitDetail: ThrottlerLimitDetail
  ): Promise<string> {
    const req = context.switchToHttp().getRequest<Request>()
    const path = req?.path ?? ''
    if (path.endsWith('/auth/login')) {
      return '登录尝试过于频繁，请 15 分钟后再试'
    }
    if (path.endsWith('/auth/register')) {
      return '注册尝试过于频繁，请 15 分钟后再试'
    }
    return '请求过于频繁，请稍后再试'
  }
}
