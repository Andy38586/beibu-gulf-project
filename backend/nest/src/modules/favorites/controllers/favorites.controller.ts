import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'

import { DtoPipe } from '../../../common/pipes/dto.pipe'
import { AuthGuard } from '../../auth/guards/auth.guard'
import { FavoriteAddBody, ItemTypeParam } from '../dto/favorites.dto'
import { FavoritesService } from '../services/favorites.service'

// 收藏属于用户数据，全部需登录（对齐 Express router.use(authenticate)；02 §4.5）
@Controller('favorites')
@UseGuards(AuthGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  // GET 返回项数组本身（对齐 Express sendSuccess(res, items)，非 {items:[]} 包裹）
  @Get()
  list(@Req() req: Request & { user?: { id: string } }) {
    return this.favoritesService.list(req.user!.id)
  }

  @Post()
  // 对齐 Express add：sendSuccess 默认 200（非 201——收藏非资源创建语义）
  @HttpCode(200)
  add(
    @Body(new DtoPipe(FavoriteAddBody.parse)) body: FavoriteAddBody,
    @Req() req: Request & { user?: { id: string } }
  ): Promise<{ favorite: unknown; existed: boolean }> {
    return this.favoritesService.add(req.user!.id, body)
  }

  @Delete(':itemType/:itemId')
  remove(
    @Param('itemType', new DtoPipe(ItemTypeParam.parse)) { itemType }: ItemTypeParam,
    @Param('itemId') itemId: string,
    @Req() req: Request & { user?: { id: string } }
  ): Promise<{ removed: boolean }> {
    return this.favoritesService
      .remove(req.user!.id, itemType, itemId)
      .then((removed) => ({ removed }))
  }
}
