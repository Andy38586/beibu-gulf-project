// @vitest-environment node
// favoritesRepository 核心语义测试：全局唯一收藏（同用户 itemType+itemId 幂等）、
// 用户隔离、删除。fileStore 以内存桩替换，不触真实 data/favorites.json。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const memory = vi.hoisted(() => ({ state: [] }))

vi.mock('../../utils/fileStore.js', () => ({
  createFileStore: () => ({
    sequential: (fn) => fn(),
    readAll: async () => memory.state,
    writeAll: async (data) => {
      memory.state = data
    },
  }),
}))

import { add, findByKey, remove } from '../favoritesRepository.js'

beforeEach(() => {
  memory.state = []
})

const item = {
  itemType: 'xiaoqu',
  itemId: 'B1',
  name: '小区A',
  lng: 108.5,
  lat: 21.7,
  snapshot: null,
}

describe('favoritesRepository（全局唯一收藏）', () => {
  it('add 首次写入；同键再次 add 幂等返回既有项，不重复落库', async () => {
    const first = await add('u1', item)
    expect(first.existed).toBe(false)
    const again = await add('u1', item)
    expect(again.existed).toBe(true)
    expect(again.favorite.id).toBe(first.favorite.id)
    expect(memory.state).toHaveLength(1)
  })

  it('同 itemType+itemId 不同用户互不干扰', async () => {
    await add('u1', item)
    const other = await add('u2', item)
    expect(other.existed).toBe(false)
    expect(memory.state).toHaveLength(2)
  })

  it('findByKey 命中返回收藏项，未命中返回 null', async () => {
    await add('u1', item)
    expect(findByKey('u1', 'xiaoqu', 'B1')).resolves.toMatchObject({ itemId: 'B1' })
    expect(await findByKey('u1', 'xiaoqu', 'NOPE')).toBeNull()
  })

  it('remove 只删指定键，其他用户数据保留', async () => {
    await add('u1', item)
    await add('u2', item)
    const removed = await remove('u1', 'xiaoqu', 'B1')
    expect(removed).toBe(true)
    expect(memory.state.map((f) => f.userId)).toEqual(['u2'])
    expect(await remove('u1', 'xiaoqu', 'B1')).toBe(false)
  })
})
