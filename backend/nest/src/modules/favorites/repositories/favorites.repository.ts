import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { DbService } from '../../../infra/db/db.service'

// favorites 表数据访问（cruise 豁免层）。
// 语义对齐老 Express favoritesRepository.js（favorites.json → PG 单表）：
// 全局唯一键 (user_id, item_type, item_id)，幂等添加 = 冲突忽略；
// created_at 列承载 Express 的 savedAt（ISO 字符串口径），SQL 全参数化
export interface FavoriteRow {
  id: string | null
  user_id: string
  item_type: string
  item_id: string
  name: string | null
  lng: number | null
  lat: number | null
  snapshot: unknown
  created_at: string | null
}

const FAV_COLUMNS = 'id, user_id, item_type, item_id, name, lng, lat, snapshot, created_at'

@Injectable()
export class FavoritesRepository {
  constructor(private readonly db: DbService) {}

  private toView(row: FavoriteRow) {
    return {
      id: row.id ?? '',
      userId: row.user_id,
      itemType: row.item_type,
      itemId: row.item_id,
      name: row.name ?? '',
      lng: row.lng ?? 0,
      lat: row.lat ?? 0,
      snapshot: row.snapshot ?? null,
      savedAt: row.created_at,
    }
  }

  // 最新在前（对齐 Express savedAt 降序）
  async findAllByUserId(userId: string) {
    const res = await this.db.query<FavoriteRow>(
      `SELECT ${FAV_COLUMNS} FROM favorites WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    )
    return res.rows.map((r) => this.toView(r))
  }

  async findByKey(userId: string, itemType: string, itemId: string) {
    const res = await this.db.query<FavoriteRow>(
      `SELECT ${FAV_COLUMNS} FROM favorites WHERE user_id = $1 AND item_type = $2 AND item_id = $3`,
      [userId, itemType, itemId]
    )
    return res.rows[0] ? this.toView(res.rows[0]) : null
  }

  // 幂等添加：唯一键冲突（并发窗口）由 ON CONFLICT 兜底，落空即回读既有项——
  // 与 Express"锁内查重返回既有项"语义等价且消除 TOCTOU
  async add(
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
    const inserted = await this.db.query<FavoriteRow>(
      `INSERT INTO favorites (id, user_id, item_type, item_id, name, lng, lat, snapshot, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       ON CONFLICT (user_id, item_type, item_id) DO NOTHING
       RETURNING ${FAV_COLUMNS}`,
      [
        randomUUID(),
        userId,
        item.itemType,
        item.itemId,
        item.name,
        item.lng,
        item.lat,
        item.snapshot == null ? null : JSON.stringify(item.snapshot),
        new Date().toISOString(),
      ]
    )
    if (inserted.rows[0]) {
      return { favorite: this.toView(inserted.rows[0]), existed: false }
    }
    const existing = await this.findByKey(userId, item.itemType, item.itemId)
    return { favorite: existing, existed: true }
  }

  async remove(userId: string, itemType: string, itemId: string): Promise<boolean> {
    const res = await this.db.query(
      'DELETE FROM favorites WHERE user_id = $1 AND item_type = $2 AND item_id = $3',
      [userId, itemType, itemId]
    )
    return (res.rowCount ?? 0) > 0
  }
}
