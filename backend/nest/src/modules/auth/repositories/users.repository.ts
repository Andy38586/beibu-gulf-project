import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import { DbService } from '../../../infra/db/db.service'

// users 表数据访问（cruise 豁免层：DB 访问仅 repositories/ 与 infra/db/ 合法）。
// 行为对齐老 Express userService.js（users.json 文件存储 → PG 单表），
// 全部 SQL 参数化（专项1 指标 8.2 SQL 注入面 P0）
export interface StoredUser {
  id: string
  username: string
  password: string
  token_version: number
  created_at: string | null
}

const USER_COLUMNS = 'id, username, password, token_version, created_at'

// users.username 唯一约束（unique_violation）→ 并发注册兜底，
// 与 Express 在文件锁内查重的语义等价（消除 TOCTOU 竞态）
const UNIQUE_VIOLATION = '23505'

@Injectable()
export class UsersRepository {
  constructor(private readonly db: DbService) {}

  async findById(id: string): Promise<StoredUser | null> {
    const res = await this.db.query<StoredUser>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [
      id,
    ])
    return res.rows[0] ?? null
  }

  async findByUsername(username: string): Promise<StoredUser | null> {
    const res = await this.db.query<StoredUser>(
      `SELECT ${USER_COLUMNS} FROM users WHERE username = $1`,
      [username]
    )
    return res.rows[0] ?? null
  }

  async create(username: string, passwordHash: string): Promise<StoredUser> {
    // 不可预测用户 ID（对齐 Express crypto.randomUUID()）；created_at 保持 ISO 字符串口径
    try {
      const res = await this.db.query<StoredUser>(
        `INSERT INTO users (id, username, password, token_version, created_at)
         VALUES ($1, $2, $3, 0, $4)
         RETURNING ${USER_COLUMNS}`,
        [randomUUID(), username, passwordHash, new Date().toISOString()]
      )
      return res.rows[0]
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new BusinessError(ErrorCode.DUPLICATE_USERNAME)
      }
      throw err
    }
  }

  // 令牌吊销：自增 tokenVersion，旧 token 在守卫校验时失效（对齐 Express updateTokenVersion）
  async incrementTokenVersion(id: string): Promise<number | null> {
    const res = await this.db.query<Pick<StoredUser, 'token_version'>>(
      'UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING token_version',
      [id]
    )
    return res.rows[0]?.token_version ?? null
  }

  // 静默迁移用：旧密码哈希登录成功后以原始密码重哈希回写（对齐 Express updatePassword）
  async updatePassword(id: string, passwordHash: string): Promise<boolean> {
    const res = await this.db.query('UPDATE users SET password = $2 WHERE id = $1', [
      id,
      passwordHash,
    ])
    return (res.rowCount ?? 0) === 1
  }
}
