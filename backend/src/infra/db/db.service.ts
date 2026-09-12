import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common'
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'

import { ConfigService } from '../config/config.service'

import { parseDbConfig } from './db.config'

// 全应用唯一连接池（单例 provider）；SQL 只允许出现在 repository 层，
// service/controller 经 DbService 之外的层访问 DB 会被 cruise 拦截
//（依赖规则 nest-db-access-only-in-repository：DB 访问只允许出现在 repository 层）
@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly pool: Pool
  private readonly logger = new Logger(DbService.name)

  // 配置经 ConfigService 集中读取；直连构造（真库单测 new DbService()）无注入时
  // 回落原 process.env 解析，行为不变
  constructor(@Optional() private readonly config?: ConfigService) {
    this.pool = new Pool(this.config ? this.config.dbConfig : parseDbConfig(process.env))
    // 池级 error 监听（审查 d140）：空闲连接被杀（DB 重启/闪断/故障转移）时 pg 会向
    // Pool 发 'error' 事件，无监听则 Node 按未处理 'error' 直接退出进程——全 API 瞬死
    // 且在途请求连 5xx 信封都发不出（2026-09-12 动态测试实锤：docker stop 即崩）。
    // 此处降级为日志；每请求级致命错误已由 isFatalDbError 上抛（d135），两层互不干扰。
    this.pool.on('error', (err: Error) => {
      this.logger.error(`[db] 连接池空闲连接错误（进程不退出）: ${err.message}`)
    })
  }

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values)
  }

  // 事务执行器：BEGIN → runner(client) → COMMIT，异常回滚后抛原错误。
  // 供 repository 层"先读后写"语义（如 plans 的 payload 读改写）原子化，
  // 配合 runner 内 SELECT ... FOR UPDATE 消除并发丢更新
  async withTransaction<T>(runner: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await runner(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  // 应用关闭时释放全部连接，避免 watch 热重载/测试退出后悬挂句柄
  async onModuleDestroy(): Promise<void> {
    await this.pool.end()
  }
}
