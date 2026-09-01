import { Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'

import { BusinessErrorFilter } from './common/filters/business-error.filter'
import { EnvelopeThrottlerGuard } from './common/guards/envelope-throttler.guard'
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor'
import { HealthModule } from './health/health.module'
import { DbModule } from './infra/db/db.module'
import { AuthModule } from './modules/auth/auth.module'
import { FavoritesModule } from './modules/favorites/favorites.module'
import { ForecastModule } from './modules/forecast/forecast.module'
import { PlansModule } from './modules/plans/plans.module'

// 限流对齐 Express：命名桶 global 1000/15min + login/register 各 50/15min（T3.1），
// 路由经 @SkipThrottle 选择归属桶；forecast 豁免在 T3.4 加。
// health 探针计入全局限流（T1.3 已记录口径，TODO(T6.3) 部署整合时统一对齐）
@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'global', ttl: 15 * 60 * 1000, limit: 1000 },
      { name: 'login', ttl: 15 * 60 * 1000, limit: 50 },
      { name: 'register', ttl: 15 * 60 * 1000, limit: 50 },
    ]),
    DbModule,
    AuthModule,
    FavoritesModule,
    PlansModule,
    ForecastModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: EnvelopeThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: BusinessErrorFilter },
  ],
})
export class AppModule {}
