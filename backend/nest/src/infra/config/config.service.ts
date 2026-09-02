import { existsSync } from 'node:fs'
import path from 'node:path'

import { Injectable, Optional } from '@nestjs/common'

import { getJwtSecret } from '../../common/utils/jwt.util'
import { DbConfig, parseDbConfig } from '../db/db.config'

// 数据目录解析：优先 DATA_DIR env；否则从 cwd 向上找 backend/data（仓根或 backend/nest
// cwd 都能命中）；一路找不到回落 <cwd>/backend/data（报 ENOENT 而非静默错目录）
export function resolveDataDir(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
  cwd: string = process.cwd()
): string {
  if (env.DATA_DIR) return path.resolve(env.DATA_DIR)
  let dir = cwd
  for (;;) {
    const candidate = path.join(dir, 'backend', 'data')
    if (exists(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(cwd, 'backend/data')
    dir = parent
  }
}

/**
 * 配置集中入口：PORT/NODE_ENV/JWT_SECRET/DATA_DIR/PG_* 全部经此类读取，
 * 业务代码不再散落 process.env。环境读取在构造时一次性定型，
 * 测试可直接 new ConfigService({...}) 注入假环境。
 * JWT 验签路径保持 jwt.util 的懒校验语义（auth 用时抛错），本类只做统一出口。
 */
@Injectable()
export class ConfigService {
  readonly port: number
  readonly nodeEnv: string
  readonly dbConfig: DbConfig

  private readonly env: NodeJS.ProcessEnv

  // @Optional：NodeJS.ProcessEnv 无 DI token，Nest 环境解析不到即用默认 process.env；
  // 单测直连构造传假环境
  constructor(@Optional() env: NodeJS.ProcessEnv = process.env) {
    this.env = env
    // Number 语义与原 main.ts 完全一致：NaN/0/空串回落 3100（迁移期避让 Express 3000）
    this.port = Number(env.PORT) || 3100
    this.nodeEnv = env.NODE_ENV ?? 'development'
    this.dbConfig = parseDbConfig(env)
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production'
  }

  get dataDir(): string {
    return resolveDataDir(this.env)
  }

  // 强校验单一事实源在 jwt.util：缺 secret / 长度不足直接抛错（不带着弱配置上线）
  get jwtSecret(): string {
    return getJwtSecret()
  }

  // 启动必填校验：main.ts 在 listen 前调用，缺必填配置直接 fail fast。
  // 相比原先「auth 路由用时才抛错」，起服务即可感知配置缺失，避免带病上线
  validateStartup(): void {
    void this.jwtSecret
  }
}
