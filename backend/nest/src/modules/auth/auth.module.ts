import { Module } from '@nestjs/common'

import { AuthController } from './controllers/auth.controller'
import { AuthGuard } from './guards/auth.guard'
import { UsersRepository } from './repositories/users.repository'
import { AuthService } from './services/auth.service'

// T1.3 落守卫与 users 仓储（guard 的 tokenVersion 校验依赖）；
// T3.1 补 controller/service（register/login/logout/me）
@Module({
  controllers: [AuthController],
  providers: [UsersRepository, AuthGuard, AuthService],
  exports: [UsersRepository, AuthGuard],
})
export class AuthModule {}
