import { Module } from '@nestjs/common'

import { AuthController } from './controllers/auth.controller'
import { AuthGuard } from './guards/auth.guard'
import { UsersRepository } from './repositories/users.repository'
import { AuthService } from './services/auth.service'

// 模块组成：users 仓储（守卫 tokenVersion 校验依赖）+ controller/service（register/login/logout/me）
@Module({
  controllers: [AuthController],
  providers: [UsersRepository, AuthGuard, AuthService],
  exports: [UsersRepository, AuthGuard],
})
export class AuthModule {}
