import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DbService } from '../src/infra/db/db.service'
import { FavoritesRepository } from '../src/modules/favorites/repositories/favorites.repository'

// favoritesRepository 真库单测（手册 §五：真实库 + 测试前缀 + 清理钩子）。
// 用例逐条移植 Express favoritesRepository.test.js 语义（fileStore 内存桩 → v3_dev 真库）
const U1 = '__t3_fav_uid_0' // users.id（FK 指向 users.id，非 username）
const U2 = '__t3_fav_uid_1'

const item = {
  itemType: 'xiaoqu',
  itemId: '__t3_B1',
  name: '小区A',
  lng: 108.5,
  lat: 21.7,
  snapshot: null,
}

describe('favoritesRepository（真库）', () => {
  let db: DbService
  let repo: FavoritesRepository

  beforeAll(async () => {
    db = new DbService()
    repo = new FavoritesRepository(db)
    await db.query(
      "DELETE FROM favorites WHERE user_id IN (SELECT id FROM users WHERE substr(username, 1, 8) = '__t3_fav')"
    )
    await db.query("DELETE FROM users WHERE substr(username, 1, 8) = '__t3_fav'")
    for (const [i, username] of [U1, U2].entries()) {
      await db.query(
        "INSERT INTO users (id, username, password, token_version, created_at) VALUES ($1, $2, 'v3-migrated', 0, '2026-09-01T00:00:00.000Z')",
        [`__t3_fav_uid_${i}`, username]
      )
    }
  })

  afterAll(async () => {
    await db.query(
      "DELETE FROM favorites WHERE user_id IN (SELECT id FROM users WHERE substr(username, 1, 8) = '__t3_fav')"
    )
    await db.query("DELETE FROM users WHERE substr(username, 1, 8) = '__t3_fav'")
    await db.onModuleDestroy()
  })

  it('add 首次写入；同键再次 add 幂等返回既有项，不重复落库', async () => {
    const first = await repo.add(U1, item)
    expect(first.existed).toBe(false)
    const again = await repo.add(U1, item)
    expect(again.existed).toBe(true)
    expect(again.favorite!.id).toBe(first.favorite!.id)
    const count = await db.query('SELECT count(*)::int AS n FROM favorites WHERE user_id = $1', [
      U1,
    ])
    expect(count.rows[0].n).toBe(1)
  })

  it('同 itemType+itemId 不同用户互不干扰', async () => {
    await repo.add(U1, item)
    const other = await repo.add(U2, item)
    expect(other.existed).toBe(false)
    const count = await db.query('SELECT count(*)::int AS n FROM favorites WHERE item_id = $1', [
      item.itemId,
    ])
    expect(count.rows[0].n).toBe(2)
  })

  it('findByKey 命中返回收藏项，未命中返回 null', async () => {
    await repo.add(U1, item)
    const hit = await repo.findByKey(U1, 'xiaoqu', item.itemId)
    expect(hit).toMatchObject({ itemId: item.itemId, userId: U1, name: '小区A' })
    expect(await repo.findByKey(U1, 'xiaoqu', '__t3_NOPE')).toBeNull()
  })

  it('remove 只删指定键，其他用户数据保留；键不存在返回 false', async () => {
    await repo.add(U1, item)
    await repo.add(U2, item)
    expect(await repo.remove(U1, 'xiaoqu', item.itemId)).toBe(true)
    const rest = await repo.findAllByUserId(U2)
    expect(rest).toHaveLength(1)
    expect(await repo.remove(U1, 'xiaoqu', item.itemId)).toBe(false)
  })

  it('list 最新在前（created_at 降序，移植 Express savedAt 排序语义）', async () => {
    await repo.add(U1, { ...item, itemId: '__t3_old', name: '旧项' })
    await new Promise((r) => setTimeout(r, 10))
    await repo.add(U1, { ...item, itemId: '__t3_new', name: '新项' })
    const list = await repo.findAllByUserId(U1)
    expect(list.map((f) => f.itemId)).toEqual(['__t3_new', '__t3_old'])
  })
})
