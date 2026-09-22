import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DbService } from '../src/infra/db/db.service'
import { PlansRepository } from '../src/modules/plans/repositories/plans.repository'

// 真库套件：需 beibu-gulf-data 库（docker-compose.v3.yml）。无库环境（CI/本机未起 PG）整体跳过，
// 避免 ECONNREFUSED 噪音；联调时 export V3_INTEGRATION_DB=1 恢复全量
const withDb = process.env.V3_INTEGRATION_DB !== undefined

// toView 键序单测（无需真库）：payload 不得覆盖权威列。
// 导入行 payload 里带整条旧记录快照（db-import.mjs:115），列值必须后置胜出，
// 否则用户重命名后刷新即回滚到 payload 里的旧名。
describe('plansRepository.toView 键序（无库）', () => {
  const fakeRow = {
    id: 'p1',
    user_id: 'user-a',
    name: '新名字',
    payload: {
      id: 'p1',
      userId: 'user-a',
      name: '导入时旧名',
      selectedKeys: ['hospital'],
    },
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
  }
  const repo = new PlansRepository({
    query: async () => ({ rows: [fakeRow] }),
  } as unknown as DbService)

  it('权威列（id/userId/name/时间戳）后置胜出，payload 只补扩展字段', async () => {
    const view = (await repo.findById('p1')) as Record<string, unknown>
    expect(view.name).toBe('新名字')
    expect(view.id).toBe('p1')
    expect(view.userId).toBe('user-a')
    expect(view.createdAt).toBe(fakeRow.created_at)
    expect(view.updatedAt).toBe(fakeRow.updated_at)
    // payload 里的扩展字段仍然下发
    expect(view.selectedKeys).toEqual(['hospital'])
  })
})

// plansRepository 真库单测：payload JSONB 整体存取 + 白名单更新 + 小区保存/移除语义
const UID = '__t3_plans_uid_0'
const CREATE_DATA = {
  userId: UID,
  name: '钦州湾方案',
  selectedKeys: ['hospital', 'park'],
  typeSettings: { defaultRadius: 3000 },
  weights: { hospital: 1.2 },
}

describe.skipIf(!withDb)('plansRepository（真库）', () => {
  let db: DbService
  let repo: PlansRepository

  beforeAll(async () => {
    db = new DbService()
    repo = new PlansRepository(db)
    await db.query(
      "DELETE FROM plans WHERE user_id IN (SELECT id FROM users WHERE substr(username, 1, 9) = '__t3_plan')"
    )
    await db.query("DELETE FROM users WHERE substr(username, 1, 9) = '__t3_plan'")
    await db.query(
      "INSERT INTO users (id, username, password, token_version, created_at) VALUES ($1, '__t3_plan_user', 'v3-migrated', 0, '2026-09-01T00:00:00.000Z')",
      [UID]
    )
  })

  afterAll(async () => {
    await db.query(
      "DELETE FROM plans WHERE user_id IN (SELECT id FROM users WHERE substr(username, 1, 9) = '__t3_plan')"
    )
    await db.query("DELETE FROM users WHERE substr(username, 1, 9) = '__t3_plan'")
    await db.onModuleDestroy()
  })

  it('create → 平面视图含 payload 展开与空 savedXiaoqu', async () => {
    const plan = await repo.create(CREATE_DATA)
    expect(plan).toMatchObject({
      id: expect.any(String),
      userId: UID,
      name: '钦州湾方案',
      selectedKeys: ['hospital', 'park'],
      typeSettings: { defaultRadius: 3000 },
      weights: { hospital: 1.2 },
      savedXiaoqu: [],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
  })

  it('update 白名单字段写 payload；name 走列；createdAt 不可变', async () => {
    const plan = await repo.create(CREATE_DATA)
    const updated = await repo.update(plan.id as string, {
      name: '新名字',
      savedXiaoqu: [{ id: 'x1', name: '小区' }],
      evil: 2, // 白名单外键必须被挡住
    })
    expect(updated).toMatchObject({
      name: '新名字',
      savedXiaoqu: [{ id: 'x1', name: '小区' }],
      selectedKeys: CREATE_DATA.selectedKeys, // 未传字段保留
    })
    expect((updated as Record<string, unknown>).evil).toBeUndefined()
    expect((updated as Record<string, unknown>).createdAt).toBe(plan.createdAt)
  })

  it('saveXiaoqu 追加后同 id 再保存为覆盖（savedAt 刷新，列表长度不变）', async () => {
    const plan = await repo.create(CREATE_DATA)
    const pid = plan.id as string
    await repo.saveXiaoqu(pid, { id: 'x1', name: '小区A', score: 88 })
    const once = await repo.findById(pid)
    expect((once as Record<string, unknown>).savedXiaoqu).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 5))
    const again = await repo.saveXiaoqu(pid, { id: 'x1', name: '小区A改', score: 90 })
    const saved = (again as Record<string, unknown>).savedXiaoqu as Record<string, unknown>[]
    expect(saved).toHaveLength(1)
    expect(saved[0].name).toBe('小区A改')
    // 与第一次保存的同条目 savedAt 比较（毫秒精度时间戳，两次保存间隔 5ms 必不同）
    const firstSaved = (once as Record<string, unknown>).savedXiaoqu as Record<string, unknown>[]
    expect(saved[0].savedAt).not.toBe(firstSaved[0].savedAt) // savedAt 已刷新
  })

  it('removeXiaoqu 键不存在返回原方案；存在则过滤', async () => {
    const plan = await repo.create(CREATE_DATA)
    const pid = plan.id as string
    await repo.saveXiaoqu(pid, { id: 'x1', name: '小区A' })
    const unchanged = await repo.removeXiaoqu(pid, 'nope')
    expect(((unchanged as Record<string, unknown>).savedXiaoqu as unknown[]).length).toBe(1)
    const removed = await repo.removeXiaoqu(pid, 'x1')
    expect((removed as Record<string, unknown>).savedXiaoqu).toEqual([])
  })

  it('remove 删除成功 true，重复删 false；findAllByUserId 用户隔离', async () => {
    const plan = await repo.create({ ...CREATE_DATA, name: '待删方案' })
    expect(await repo.remove(plan.id as string)).toBe(true)
    expect(await repo.remove(plan.id as string)).toBe(false)
    const list = await repo.findAllByUserId(UID)
    expect(list.some((p) => p.name === '待删方案')).toBe(false)
  })
})
