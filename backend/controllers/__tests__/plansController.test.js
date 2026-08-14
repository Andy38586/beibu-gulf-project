// @vitest-environment node
// 副-14：plansController 单元测试（此前 0% 覆盖）——mock repository，覆盖 CRUD 与鉴权/错误路径
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BusinessError } from '../../utils/BusinessError.js'

vi.mock('../../repositories/plansRepository.js', () => ({
  findAllByUserId: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  saveXiaoqu: vi.fn(),
  removeXiaoqu: vi.fn(),
}))

import * as plansRepo from '../../repositories/plansRepository.js'
import {
  createOne,
  deleteOne,
  getAll,
  getOne,
  removeXiaoquFromOne,
  saveXiaoquToOne,
  updateOne,
} from '../plansController.js'

const USER = { id: 'u1' }
const PLAN = { id: 'p1', userId: 'u1', name: '钦州湾方案', selectedKeys: ['hospital'] }

function mockReqRes(overrides = {}) {
  const req = { user: USER, params: {}, body: {}, ...overrides }
  const res = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  }
  const next = vi.fn()
  return { req, res, next }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getAll', () => {
  it('返回当前用户方案列表', async () => {
    plansRepo.findAllByUserId.mockResolvedValue([PLAN])
    const { req, res, next } = mockReqRes()
    await getAll(req, res, next)
    expect(plansRepo.findAllByUserId).toHaveBeenCalledWith('u1')
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: [PLAN] })
    expect(next).not.toHaveBeenCalled()
  })

  it('仓库异常透传 next', async () => {
    plansRepo.findAllByUserId.mockRejectedValue(new Error('db down'))
    const { req, res, next } = mockReqRes()
    await getAll(req, res, next)
    expect(next).toHaveBeenCalledWith(expect.any(Error))
  })
})

describe('getOne', () => {
  it('命中且属当前用户 → 返回方案', async () => {
    plansRepo.findById.mockResolvedValue(PLAN)
    const { req, res, next } = mockReqRes({ params: { id: 'p1' } })
    await getOne(req, res, next)
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: PLAN })
  })

  it('不存在 → 404 业务错误', async () => {
    plansRepo.findById.mockResolvedValue(null)
    const { req, res, next } = mockReqRes({ params: { id: 'p1' } })
    await getOne(req, res, next)
    expect(next).toHaveBeenCalledWith(expect.any(BusinessError))
    expect(next.mock.calls[0][0].code).toBe(404001)
  })

  it('他人方案 → 403 业务错误', async () => {
    plansRepo.findById.mockResolvedValue({ ...PLAN, userId: 'other' })
    const { req, res, next } = mockReqRes({ params: { id: 'p1' } })
    await getOne(req, res, next)
    expect(next.mock.calls[0][0].code).toBe(403001)
  })
})

describe('createOne', () => {
  it('合法输入 → 201 创建', async () => {
    plansRepo.findAllByUserId.mockResolvedValue([])
    plansRepo.create.mockResolvedValue({ ...PLAN, id: 'new' })
    const { req, res, next } = mockReqRes({
      body: { name: '方案A', selectedKeys: ['park'], typeSettings: {}, weights: null },
    })
    await createOne(req, res, next)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ code: 201, data: { ...PLAN, id: 'new' } })
    expect(next).not.toHaveBeenCalled()
  })

  it('缺 name/selectedKeys → 400', async () => {
    const { req, res, next } = mockReqRes({ body: { name: 'x' } })
    await createOne(req, res, next)
    expect(next.mock.calls[0][0].code).toBe(400001)
  })

  it('名称含非法字符 → 400', async () => {
    const { req, res, next } = mockReqRes({
      body: { name: '方案<script>', selectedKeys: ['park'] },
    })
    await createOne(req, res, next)
    expect(next.mock.calls[0][0].code).toBe(400001)
  })

  it('重名 → 409', async () => {
    plansRepo.findAllByUserId.mockResolvedValue([PLAN])
    const { req, res, next } = mockReqRes({
      body: { name: '钦州湾方案', selectedKeys: ['park'] },
    })
    await createOne(req, res, next)
    expect(next.mock.calls[0][0].code).toBe(409002)
  })
})

describe('updateOne', () => {
  it('属主更新名称 → 200', async () => {
    plansRepo.findById.mockResolvedValue(PLAN)
    plansRepo.findAllByUserId.mockResolvedValue([])
    plansRepo.update.mockResolvedValue({ ...PLAN, name: '新名' })
    const { req, res, next } = mockReqRes({
      params: { id: 'p1' },
      body: { name: '新名' },
    })
    await updateOne(req, res, next)
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: { ...PLAN, name: '新名' } })
  })

  it('改名与其他方案重名 → 409', async () => {
    plansRepo.findById.mockResolvedValue(PLAN)
    plansRepo.findAllByUserId.mockResolvedValue([{ ...PLAN, id: 'p2', name: '新名' }])
    const { req, res, next } = mockReqRes({
      params: { id: 'p1' },
      body: { name: '新名' },
    })
    await updateOne(req, res, next)
    expect(next.mock.calls[0][0].code).toBe(409002)
  })
})

describe('deleteOne', () => {
  it('属主删除 → 204', async () => {
    plansRepo.findById.mockResolvedValue(PLAN)
    plansRepo.remove.mockResolvedValue(true)
    const { req, res, next } = mockReqRes({ params: { id: 'p1' } })
    await deleteOne(req, res, next)
    expect(res.status).toHaveBeenCalledWith(204)
    expect(res.send).toHaveBeenCalled()
  })

  it('不存在 → 404', async () => {
    plansRepo.findById.mockResolvedValue(null)
    const { req, res, next } = mockReqRes({ params: { id: 'p1' } })
    await deleteOne(req, res, next)
    expect(next.mock.calls[0][0].code).toBe(404001)
  })
})

describe('saveXiaoquToOne / removeXiaoquFromOne', () => {
  it('保存小区 → 200', async () => {
    plansRepo.findById.mockResolvedValue(PLAN)
    plansRepo.saveXiaoqu.mockResolvedValue(PLAN)
    const { req, res, next } = mockReqRes({
      params: { id: 'p1' },
      body: { xiaoqu: { id: 'x1', name: '小区' } },
    })
    await saveXiaoquToOne(req, res, next)
    expect(plansRepo.saveXiaoqu).toHaveBeenCalledWith('p1', { id: 'x1', name: '小区' })
    expect(res.json).toHaveBeenCalled()
  })

  it('缺小区 id → 400', async () => {
    plansRepo.findById.mockResolvedValue(PLAN)
    const { req, res, next } = mockReqRes({ params: { id: 'p1' }, body: { xiaoqu: {} } })
    await saveXiaoquToOne(req, res, next)
    expect(next.mock.calls[0][0].code).toBe(400001)
  })

  it('移除小区 → 200', async () => {
    plansRepo.findById.mockResolvedValue(PLAN)
    plansRepo.removeXiaoqu.mockResolvedValue(PLAN)
    const { req, res, next } = mockReqRes({ params: { id: 'p1', xiaoquId: 'x1' } })
    await removeXiaoquFromOne(req, res, next)
    expect(plansRepo.removeXiaoqu).toHaveBeenCalledWith('p1', 'x1')
  })

  it('他人方案 → 403', async () => {
    plansRepo.findById.mockResolvedValue({ ...PLAN, userId: 'other' })
    const { req, res, next } = mockReqRes({ params: { id: 'p1' }, body: { xiaoqu: { id: 'x' } } })
    await saveXiaoquToOne(req, res, next)
    expect(next.mock.calls[0][0].code).toBe(403001)
  })
})
