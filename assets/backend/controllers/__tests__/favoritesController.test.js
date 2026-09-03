// @vitest-environment node
// favoritesController 测试：入参校验 + 幂等标记透传（仓储层去重逻辑另见 favoritesRepository.test）
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessError, ErrorCode } from '../../utils/BusinessError.js'

const repoMock = vi.hoisted(() => ({
  findAllByUserId: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
}))

// 隔离仓储层（真实实现会读写 data/favorites.json）
vi.mock('../../repositories/favoritesRepository.js', () => repoMock)

import { add, list, remove } from '../favoritesController.js'

function createRes() {
  const res = { json: vi.fn(), status: vi.fn() }
  res.status.mockReturnValue(res)
  return res
}
function createNext() {
  return vi.fn()
}
function createReq(over = {}) {
  return { user: { id: 'u1' }, ...over }
}

const validBody = {
  itemType: 'xiaoqu',
  itemId: 'B1',
  name: '小区A',
  lng: 108.5,
  lat: 21.7,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('favoritesController.list', () => {
  it('返回当前用户收藏（信封 200），不落 next', async () => {
    repoMock.findAllByUserId.mockResolvedValue([
      { itemType: 'xiaoqu', itemId: 'B1', name: '小区A' },
    ])
    const res = createRes()
    const next = createNext()
    await list(createReq(), res, next)
    expect(res.json).toHaveBeenCalledWith({
      code: 200,
      data: [{ itemType: 'xiaoqu', itemId: 'B1', name: '小区A' }],
    })
    expect(next).not.toHaveBeenCalled()
  })
})

describe('favoritesController.add', () => {
  it('合法入参 → 校验后透传 repo.add，幂等标记随信封返回', async () => {
    repoMock.add.mockResolvedValue({
      favorite: { id: 'f1', userId: 'u1', ...validBody, savedAt: '2026-08-29T00:00:00.000Z' },
      existed: false,
    })
    const res = createRes()
    await add(createReq({ body: validBody }), res, createNext())
    expect(repoMock.add).toHaveBeenCalledWith('u1', {
      itemType: 'xiaoqu',
      itemId: 'B1',
      name: '小区A',
      lng: 108.5,
      lat: 21.7,
      snapshot: null,
    })
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ existed: false }) })
    )
  })

  it.each([
    ['itemType 非白名单', { ...validBody, itemType: 'poi' }],
    ['缺 itemId', { ...validBody, itemId: '' }],
    ['缺 name', { ...validBody, name: '' }],
    ['lng 非数值', { ...validBody, lng: 'abc' }],
  ])('%s → next 收到 BusinessError(INVALID_PARAMS)', async (_label, body) => {
    const res = createRes()
    const next = createNext()
    await add(createReq({ body }), res, next)
    expect(next).toHaveBeenCalledTimes(1)
    const err = next.mock.calls[0][0]
    expect(err).toBeInstanceOf(BusinessError)
    expect(err.code).toBe(ErrorCode.INVALID_PARAMS.code)
    expect(res.json).not.toHaveBeenCalled()
  })
})

describe('favoritesController.remove', () => {
  it('合法删除 → removed: true', async () => {
    repoMock.remove.mockResolvedValue(true)
    const res = createRes()
    await remove(createReq({ params: { itemType: 'xiaoqu', itemId: 'B1' } }), res, createNext())
    expect(repoMock.remove).toHaveBeenCalledWith('u1', 'xiaoqu', 'B1')
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: { removed: true } })
  })

  it('itemType 非白名单 → next 收到 BusinessError', async () => {
    const res = createRes()
    const next = createNext()
    await remove(createReq({ params: { itemType: 'poi', itemId: 'B1' } }), res, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(res.json).not.toHaveBeenCalled()
  })
})
