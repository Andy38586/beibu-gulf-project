import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'

import { PlansController } from './controllers/plans.controller'
import { PlansRepository } from './repositories/plans.repository'
import { PlansService } from './services/plans.service'

// 方案模块（T3.3）：AuthModule 提供 AuthGuard（类级 @UseGuards 全路由需登录）
@Module({
  imports: [AuthModule],
  controllers: [PlansController],
  providers: [PlansRepository, PlansService],
})
export class PlansModule {}
