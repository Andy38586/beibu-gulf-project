import { Injectable } from '@nestjs/common'

import { DbService } from '../../../infra/db/db.service'

// users 表数据访问（cruise 豁免层：DB 访问仅 repositories/ 与 infra/db/ 合法）。
// T1.3 先落认证守卫所需的最小查询，T3.1 auth 模块补全 CRUD
export interface StoredUser {
  id: string
  username: string
  password: string
  token_version: number
  created_at: string | null
}

@Injectable()
export class UsersRepository {
  constructor(private readonly db: DbService) {}

  async findById(id: string): Promise<StoredUser | null> {
    const res = await this.db.query<StoredUser>(
      'SELECT id, username, password, token_version, created_at FROM users WHERE id = $1',
      [id]
    )
    return res.rows[0] ?? null
  }
}
