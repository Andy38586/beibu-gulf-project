import { Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'

import {
  THROTTLER_AUTH_LIMIT,
  THROTTLER_GLOBAL_LIMIT,
  THROTTLER_TTL_MS,
} from './common/constants/throttling.constants'
import { BusinessErrorFilter } from './common/filters/business-error.filter'
import { EnvelopeThrottlerGuard } from './common/guards/envelope-throttler.guard'
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor'
import { HealthModule } from './health/health.module'
import { ConfigModule } from './infra/config/config.module'
import { DbModule } from './infra/db/db.module'
import { DataFilesModule } from './infra/files/data-files.module'
import { AuthModule } from './modules/auth/auth.module'
import { FavoritesModule } from './modules/favorites/favorites.module'
import { FloodModule } from './modules/flood/flood.module'
import { ForecastModule } from './modules/forecast/forecast.module'
import { PlansModule } from './modules/plans/plans.module'
import { SiteAnalysisModule } from './modules/site-analysis/site-analysis.module'

// 限流对齐 Express：命名桶 global 1000/15min + login/register 各 50/15min；
// 路由经 @SkipThrottle 选择归属桶；forecast 为合法高频交互（时间轴轮播）豁免。
// health 探针计入全局限流（部署整合时统一对齐；5s 间隔约 180 次/15min，远低于 1000 上限）
@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRoot([
      { name: 'global', ttl: THROTTLER_TTL_MS, limit: THROTTLER_GLOBAL_LIMIT },
      { name: 'login', ttl: THROTTLER_TTL_MS, limit: THROTTLER_AUTH_LIMIT },
      { name: 'register', ttl: THROTTLER_TTL_MS, limit: THROTTLER_AUTH_LIMIT },
    ]),
    DbModule,
    DataFilesModule,
    AuthModule,
    FavoritesModule,
    PlansModule,
    FloodModule,
    ForecastModule,
    SiteAnalysisModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: EnvelopeThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: BusinessErrorFilter },
  ],
})
export class AppModule {}
