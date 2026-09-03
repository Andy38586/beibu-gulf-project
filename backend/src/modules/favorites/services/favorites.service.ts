import { Injectable } from '@nestjs/common'

import { FavoritesRepository } from '../repositories/favorites.repository'

// 收藏业务：无额外规则，校验在 DTO 层，幂等/隔离语义在仓储层——
// service 保留一层以维持 repository→service→controller 分层约定（与 auth 模块同构）
@Injectable()
export class FavoritesService {
  constructor(private readonly favoritesRepository: FavoritesRepository) {}

  list(userId: string) {
    return this.favoritesRepository.findAllByUserId(userId)
  }

  add(
    userId: string,
    item: {
      itemType: string
      itemId: string
      name: string
      lng: number
      lat: number
      snapshot: unknown
    }
  ) {
    return this.favoritesRepository.add(userId, item)
  }

  remove(userId: string, itemType: string, itemId: string): Promise<boolean> {
    return this.favoritesRepository.remove(userId, itemType, itemId)
  }
}
