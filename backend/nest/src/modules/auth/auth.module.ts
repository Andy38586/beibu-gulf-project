import { Module } from '@nestjs/common'

import { AuthGuard } from './guards/auth.guard'
import { UsersRepository } from './repositories/users.repository'

// T1.3 阶段只提供守卫与 users 最小仓储（供 guard 的 tokenVersion 校验）；
// T3.1 补 controller/service（register/login/logout/me）
@Module({
  providers: [UsersRepository, AuthGuard],
  exports: [UsersRepository, AuthGuard],
})
export class AuthModule {}
