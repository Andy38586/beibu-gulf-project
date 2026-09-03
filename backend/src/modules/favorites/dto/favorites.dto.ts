import { ApiProperty } from '@nestjs/swagger'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'

// 收藏对象类型白名单：选址小区 / 浸没设施（对齐 Express favoritesController）
export const FAVORITE_ITEM_TYPES = ['xiaoqu', 'facility'] as const
export type FavoriteItemType = (typeof FAVORITE_ITEM_TYPES)[number]

// 校验顺序与文案逐字节对齐 Express validateItem（差异即缺陷）
export class FavoriteAddBody {
  @ApiProperty({ enum: FAVORITE_ITEM_TYPES, description: '收藏对象类型' })
  itemType!: FavoriteItemType

  @ApiProperty({ description: '对象 ID' })
  itemId!: string

  @ApiProperty({ description: '展示名' })
  name!: string

  @ApiProperty({ description: '经度' })
  lng!: number

  @ApiProperty({ description: '纬度' })
  lat!: number

  snapshot: Record<string, unknown> | null = null

  static parse(raw: unknown): FavoriteAddBody {
    const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const { itemType, itemId, name, lng, lat, snapshot } = body

    if (!FAVORITE_ITEM_TYPES.includes(itemType as FavoriteItemType)) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, 'itemType 无效（xiaoqu | facility）')
    }
    if (!itemId || typeof itemId !== 'string') {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, 'itemId 必填且为字符串')
    }
    if (!name || typeof name !== 'string') {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, 'name 必填且为字符串')
    }
    if (!Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat))) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, 'lng/lat 必须为有限数值')
    }

    const dto = new FavoriteAddBody()
    dto.itemType = itemType as FavoriteItemType
    dto.itemId = itemId
    dto.name = name
    dto.lng = Number(lng)
    dto.lat = Number(lat)
    dto.snapshot = (snapshot as Record<string, unknown> | null) ?? null
    return dto
  }
}

// DELETE /favorites/:itemType/:itemId 的路径参数白名单（对齐 Express remove 校验）
export class ItemTypeParam {
  itemType!: FavoriteItemType

  static parse(raw: unknown): ItemTypeParam {
    if (typeof raw !== 'string' || !FAVORITE_ITEM_TYPES.includes(raw as FavoriteItemType)) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, 'itemType 无效（xiaoqu | facility）')
    }
    const dto = new ItemTypeParam()
    dto.itemType = raw as FavoriteItemType
    return dto
  }
}
