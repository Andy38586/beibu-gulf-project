// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BusinessError, ErrorCode } from '../../utils/BusinessError.js'

// 隔离 repository 层，避免真实文件 IO
vi.mock('../../repositories/markersRepository.js', () => ({
  findById: vi.fn(),
  findByUserId: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

import { findById, findByUserId, create } from '../../repositories/markersRepository.js'
import { getOne, getAll, createOne } from '../markersController.js'

function createRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() }
}
function createNext() {
  return vi.fn()
}
function createUser(id = 'user-a') {
  return { id }
}
function createReq(params = {}, body = {}, user = createUser()) {
  return { params, body, user }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('markersController.getOne — IDOR 归属校验', () => {
  it('本人标注：正常返回 200 + 数据', async () => {
    const marker = { id: 'm1', userId: 'user-a', name: '我的标注' }
    findById.mockResolvedValue(marker)
    const req = createReq({ id: 'm1' })
    const res = createRes()
    const next = createNext()
    await getOne(req, res, next)
    expect(res.json).toHaveBeenCalledWith(marker)
    expect(next).not.toHaveBeenCalled()
  })

  it('他人标注：抛 FORBIDDEN，不返回数据', async () => {
    const marker = { id: 'm2', userId: 'user-b', name: '别人的标注' }
    findById.mockResolvedValue(marker)
    const req = createReq({ id: 'm2' }, {}, createUser('user-a'))
    const res = createRes()
    const next = createNext()
    await getOne(req, res, next)
    expect(res.json).not.toHaveBeenCalled()
    const err = next.mock.calls[0][0]
    expect(err).toBeInstanceOf(BusinessError)
    // 与项目约定一致（见 forecastController.test.js），code 为数字
    expect(err.code).toBe(ErrorCode.FORBIDDEN.code)
    expect(err.status).toBe(403)
  })

  it('不存在：抛 NOT_FOUND（不泄漏存在性）', async () => {
    findById.mockResolvedValue(null)
    const req = createReq({ id: 'ghost' })
    const res = createRes()
    const next = createNext()
    await getOne(req, res, next)
    const err = next.mock.calls[0][0]
    expect(err.code).toBe(ErrorCode.NOT_FOUND.code)
    expect(err.status).toBe(404)
  })
})

describe('markersController.getAll — 仅返回本人', () => {
  it('按 req.user.id 查询', async () => {
    findByUserId.mockResolvedValue([])
    const req = createReq({}, {}, createUser('user-a'))
    const res = createRes()
    await getAll(req, res, createNext())
    expect(findByUserId).toHaveBeenCalledWith('user-a')
  })
})

describe('markersController.createOne — userId 强制取自登录态', () => {
  it('即使 body 传入 userId 也被忽略', async () => {
    create.mockResolvedValue({ id: 'm3' })
    // body 恶意传入 userId: 'user-b'，应被忽略
    const req = createReq({}, { name: 'x', lng: 108, lat: 21, userId: 'user-b' }, createUser('user-a'))
    await createOne(req, createRes(), createNext())
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-a' })
    )
  })
})
