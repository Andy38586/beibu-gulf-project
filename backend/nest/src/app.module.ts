import { Module } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'

import { BusinessErrorFilter } from './common/filters/business-error.filter'
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor'
import { HealthModule } from './health/health.module'
import { DbModule } from './infra/db/db.module'
import { AuthModule } from './modules/auth/auth.module'

// 限流对齐 Express：全局 1000/15min（auth 路由级 50/15min 在 T3.1 挂；
// forecast 豁免在 T3.4 加 @SkipThrottle）。health 探针经 @SkipThrottle 豁免
@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'global', ttl: 15 * 60 * 1000, limit: 1000 }]),
    DbModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: BusinessErrorFilter },
  ],
})
export class AppModule {}
