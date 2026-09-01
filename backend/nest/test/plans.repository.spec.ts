import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { DbService } from '../src/infra/db/db.service'
import { PlansRepository } from '../src/modules/plans/repositories/plans.repository'

// plansRepository 真库单测：payload JSONB 整体存取 + 白名单更新 + 小区保存/移除语义
const UID = '__t3_plans_uid_0'
const CREATE_DATA = {
  userId: UID,
  name: '钦州湾方案',
  selectedKeys: ['hospital', 'park'],
  typeSettings: { defaultRadius: 3000 },
  weights: { hospital: 1.2 },
}

describe('plansRepository（真库）', () => {
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
    expect(saved[0].savedAt).not.toBe((once as Record<string, unknown>).savedXiaoqu) // savedAt 已刷新
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
