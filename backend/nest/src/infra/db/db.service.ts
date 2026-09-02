import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common'
import { Pool, QueryResult, QueryResultRow } from 'pg'

import { ConfigService } from '../config/config.service'

import { parseDbConfig } from './db.config'

// 全应用唯一连接池（单例 provider）；SQL 只允许出现在 repository 层，
// service/controller 经 DbService 之外的层访问 DB 会被 cruise 拦截
//（依赖规则 nest-db-access-only-in-repository：DB 访问只允许出现在 repository 层）
@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly pool: Pool

  // 配置经 ConfigService 集中读取；直连构造（真库单测 new DbService()）无注入时
  // 回落原 process.env 解析，行为不变
  constructor(@Optional() private readonly config?: ConfigService) {
    this.pool = new Pool(this.config ? this.config.dbConfig : parseDbConfig(process.env))
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
