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

import { findById, findByUserId, create, update } from '../../repositories/markersRepository.js'
import { getOne, getAll, createOne, updateOne } from '../markersController.js'

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
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: marker })
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

describe('markersController 坐标校验（M-01）', () => {
  it('createOne: 缺 name/lng/lat → INVALID_PARAMS', async () => {
    const req = createReq({}, { name: 'x' }, createUser())
    const next = createNext()
    await createOne(req, createRes(), next)
    const err = next.mock.calls[0][0]
    expect(err).toBeInstanceOf(BusinessError)
    expect(err.code).toBe(ErrorCode.INVALID_PARAMS.code)
  })

  it('createOne: NaN 坐标 → INVALID_PARAMS，不入库', async () => {
    const req = createReq({}, { name: 'x', lng: NaN, lat: 21 }, createUser())
    const next = createNext()
    await createOne(req, createRes(), next)
    expect(create).not.toHaveBeenCalled()
    const err = next.mock.calls[0][0]
    expect(err).toBeInstanceOf(BusinessError)
    expect(err.code).toBe(ErrorCode.INVALID_PARAMS.code)
  })

  it('createOne: 越界经度 → INVALID_PARAMS', async () => {
    const req = createReq({}, { name: 'x', lng: 200, lat: 21 }, createUser())
    const next = createNext()
    await createOne(req, createRes(), next)
    expect(create).not.toHaveBeenCalled()
    const err = next.mock.calls[0][0]
    expect(err).toBeInstanceOf(BusinessError)
  })

  it('createOne: 字符串坐标可正常转换为数值入库', async () => {
    create.mockResolvedValue({ id: 'm4' })
    const req = createReq({}, { name: 'x', lng: '108.5', lat: '21.2' }, createUser())
    await createOne(req, createRes(), createNext())
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ lng: 108.5, lat: 21.2 })
    )
  })
})

describe('markersController 坐标校验 — null 坐标（R-9 / B-2 类，阶段6 新发现）', () => {
  // 文档 R-9 字面量 {name, lng:null}（缺 lat）→ 因 lat 必填已返回 400，属正常校验路径。
  it('文档字面量 {name, lng:null}（缺 lat）→ INVALID_PARAMS', async () => {
    const req = createReq({}, { name: 'x', lng: null }, createUser())
    const next = createNext()
    await createOne(req, createRes(), next)
    const err = next.mock.calls[0][0]
    expect(err).toBeInstanceOf(BusinessError)
    expect(err.code).toBe(ErrorCode.INVALID_PARAMS.code)
  })

  // B-2（阶段6 复核）: lng:null 且 lat 合法时，原 `Number(null)=0` 通过范围校验被存为 (0, lat)。
  // 修复后：null 坐标直接拒绝（createOne 必填检查 + updateOne 显式判 null）。
  it('createOne: lng:null 且 lat 合法 → INVALID_PARAMS（null 不再被存为 0）', async () => {
    const req = createReq({}, { name: 'x', lng: null, lat: 21 }, createUser())
    const next = createNext()
    await createOne(req, createRes(), next)
    const err = next.mock.calls[0][0]
    expect(err).toBeInstanceOf(BusinessError)
    expect(err.code).toBe(ErrorCode.INVALID_PARAMS.code)
  })

  it('updateOne: lng:null 且 lat 合法 → INVALID_PARAMS（补登记缺口：updateOne 同样拒绝 null）', async () => {
    findById.mockResolvedValue({ id: 'm1', userId: 'user-a', lng: 108.5, lat: 21.7 })
    const req = createReq({ id: 'm1' }, { name: 'x', lng: null, lat: 21 }, createUser())
    const next = createNext()
    await updateOne(req, createRes(), next)
    const err = next.mock.calls[0][0]
    expect(err).toBeInstanceOf(BusinessError)
    expect(err.code).toBe(ErrorCode.INVALID_PARAMS.code)
  })

  it('updateOne: 只传 lat 合法值 → 正常更新（null 拒绝不影响单字段更新）', async () => {
    findById.mockResolvedValue({ id: 'm1', userId: 'user-a', lng: 108.5, lat: 21.7 })
    update.mockResolvedValue({ id: 'm1', userId: 'user-a', lng: 108.5, lat: 22 })
    const req = createReq({ id: 'm1' }, { name: 'x', lat: 22 }, createUser())
    const res = createRes()
    const next = createNext()
    await updateOne(req, res, next)
    expect(next).not.toHaveBeenCalled()
  })
})
