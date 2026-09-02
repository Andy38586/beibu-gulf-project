import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import type { PoolClient } from 'pg'

import { DbService } from '../../../infra/db/db.service'

// plans 表数据访问（cruise 豁免层）。语义对齐老 Express plansRepository.js：
// name 为列、其余业务字段整体存 payload JSONB（整体存取语义不变）；
// 视图合并顺序 {id, userId, name, ...payload, createdAt, updatedAt} 对齐 Express 平面对象
export interface PlanRow {
  id: string
  user_id: string
  name: string | null
  payload: Record<string, unknown> | null
  created_at: string | null
  updated_at: string | null
}

// 更新字段白名单（对齐 Express PLAN_UPDATE_FIELDS）：防原型链污染；
// name 走列，其余进 payload；含 flood 系字段以支持浸没方案更新
const PLAN_UPDATE_PAYLOAD_FIELDS = [
  'selectedKeys',
  'typeSettings',
  'weights',
  'savedXiaoqu',
  'businessType',
  'waterLevel',
  'floodStatistics',
  'floodFeatures',
  'floodRiskLevel',
  'affectedFacilities',
  'totalLoss',
] as const

const PLAN_COLUMNS = 'id, user_id, name, payload, created_at, updated_at'

@Injectable()
export class PlansRepository {
  constructor(private readonly db: DbService) {}

  private toView(row: PlanRow): Record<string, unknown> {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name ?? '',
      ...(row.payload ?? {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private async findByIdRow(id: string): Promise<PlanRow | null> {
    const res = await this.db.query<PlanRow>(`SELECT ${PLAN_COLUMNS} FROM plans WHERE id = $1`, [
      id,
    ])
    return res.rows[0] ?? null
  }

  async findAllByUserId(userId: string): Promise<Record<string, unknown>[]> {
    // created_at ASC 对齐 Express plans.json 追加序（文件插入序）；id 作同毫秒 tiebreak
    const res = await this.db.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM plans WHERE user_id = $1 ORDER BY created_at ASC, id ASC`,
      [userId]
    )
    return res.rows.map((r) => this.toView(r))
  }

  async findById(id: string): Promise<Record<string, unknown> | null> {
    const row = await this.findByIdRow(id)
    return row ? this.toView(row) : null
  }

  async create(data: {
    userId: string
    name: string
    selectedKeys: unknown
    typeSettings: unknown
    weights: unknown
  }): Promise<Record<string, unknown>> {
    const now = new Date().toISOString()
    const payload = {
      selectedKeys: data.selectedKeys,
      typeSettings: data.typeSettings,
      weights: data.weights,
      savedXiaoqu: [], // 对齐 Express create：已保存小区列表初始为空
    }
    const res = await this.db.query<PlanRow>(
      `INSERT INTO plans (id, user_id, name, payload, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING ${PLAN_COLUMNS}`,
      [randomUUID(), data.userId, data.name, JSON.stringify(payload), now, now]
    )
    return this.toView(res.rows[0])
  }

  // 只允许白名单字段更新（name 列 + payload 白名单键），对齐 Express update 的防污染语义。
  // 事务 + FOR UPDATE 行锁：并发同方案保存不会互相覆盖（原 read-modify-write 存在丢更新窗口）
  async update(
    id: string,
    updates: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    return this.db.withTransaction(async (client) => {
      const res = await client.query<PlanRow>(
        `SELECT ${PLAN_COLUMNS} FROM plans WHERE id = $1 FOR UPDATE`,
        [id]
      )
      const row = res.rows[0]
      if (!row) return null
      const payload: Record<string, unknown> = { ...(row.payload ?? {}) }
      for (const key of PLAN_UPDATE_PAYLOAD_FIELDS) {
        if (key in updates) payload[key] = updates[key]
      }
      const upd = await client.query<PlanRow>(
        `UPDATE plans SET name = $2, payload = $3::jsonb, updated_at = $4
         WHERE id = $1
         RETURNING ${PLAN_COLUMNS}`,
        [
          id,
          (updates.name as string | undefined) ?? row.name,
          JSON.stringify(payload),
          new Date().toISOString(),
        ]
      )
      return this.toView(upd.rows[0])
    })
  }

  async remove(id: string): Promise<boolean> {
    const res = await this.db.query('DELETE FROM plans WHERE id = $1', [id])
    return (res.rowCount ?? 0) > 0
  }

  // 保存小区：同 id 覆盖（savedAt 刷新），否则追加——对齐 Express saveXiaoqu 语义。
  // 事务 + FOR UPDATE 行锁：并发添加小区以同一行最新状态合并，不覆盖彼此的改动
  async saveXiaoqu(
    planId: string,
    xiaoqu: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    const savedAt = new Date().toISOString()
    const merged = { ...xiaoqu, savedAt }
    return this.db.withTransaction(async (client) => {
      const res = await client.query<PlanRow>(
        `SELECT ${PLAN_COLUMNS} FROM plans WHERE id = $1 FOR UPDATE`,
        [planId]
      )
      const row = res.rows[0]
      if (!row) return null
      const existing = Array.isArray(row.payload?.savedXiaoqu)
        ? (row.payload?.savedXiaoqu as Record<string, unknown>[])
        : []
      const newSavedXiaoqu = existing.some((xq) => xq.id === xiaoqu.id)
        ? existing.map((xq) => (xq.id === xiaoqu.id ? merged : xq))
        : [...existing, merged]
      return this.writePayload(client, planId, row, { ...row.payload, savedXiaoqu: newSavedXiaoqu })
    })
  }

  // 移除小区：键不存在返回原方案（对齐 Express 返回未变更 plan，不报错）；
  // 事务 + FOR UPDATE 行锁：并发场景以最新行做过滤，避免基于旧快照的误写
  async removeXiaoqu(planId: string, xiaoquId: string): Promise<Record<string, unknown> | null> {
    return this.db.withTransaction(async (client) => {
      const res = await client.query<PlanRow>(
        `SELECT ${PLAN_COLUMNS} FROM plans WHERE id = $1 FOR UPDATE`,
        [planId]
      )
      const row = res.rows[0]
      if (!row) return null
      const existing = Array.isArray(row.payload?.savedXiaoqu)
        ? (row.payload?.savedXiaoqu as Record<string, unknown>[])
        : []
      const newSavedXiaoqu = existing.filter((xq) => xq.id !== xiaoquId)
      if (newSavedXiaoqu.length === existing.length) {
        return this.toView(row)
      }
      return this.writePayload(client, planId, row, { ...row.payload, savedXiaoqu: newSavedXiaoqu })
    })
  }

  private async writePayload(
    client: PoolClient,
    planId: string,
    row: PlanRow,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const res = await client.query<PlanRow>(
      `UPDATE plans SET payload = $2::jsonb, updated_at = $3
       WHERE id = $1
       RETURNING ${PLAN_COLUMNS}`,
      [planId, JSON.stringify(payload), new Date().toISOString()]
    )
    return this.toView(res.rows[0])
  }
}
