import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'

import { FavoritesController } from './controllers/favorites.controller'
import { FavoritesRepository } from './repositories/favorites.repository'
import { FavoritesService } from './services/favorites.service'

// 收藏模块：AuthModule 提供 AuthGuard（类级 @UseGuards 全路由需登录）
@Module({
  imports: [AuthModule],
  controllers: [FavoritesController],
  providers: [FavoritesRepository, FavoritesService],
})
export class FavoritesModule {}
