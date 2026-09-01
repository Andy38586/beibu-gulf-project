import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { Pool, QueryResult, QueryResultRow } from 'pg'

import { parseDbConfig } from './db.config'

// 全应用唯一连接池（单例 provider）；SQL 只允许出现在 repository 层，
// service/controller 经 DbService 之外的层访问 DB 会被 cruise 拦截
//（nest-db-access-only-in-repository 规则 + 专项6 指标 8.3）
@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly pool: Pool

  constructor() {
    this.pool = new Pool(parseDbConfig(process.env))
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values)
  }

  // 应用关闭时释放全部连接，避免 watch 热重载/测试退出后悬挂句柄
  async onModuleDestroy(): Promise<void> {
    await this.pool.end()
  }
}
