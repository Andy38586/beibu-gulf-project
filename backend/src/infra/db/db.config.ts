export interface DbConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
  max: number
  idleTimeoutMillis: number
  connectionTimeoutMillis: number
}

// 开发默认值对齐 docker-compose.v3.yml（postgres/postgres/beibu-gulf-data@5432）；
// 生产凭据一律经环境注入，默认口令禁止外溢到生产配置（安全指标 P0）。
//
// P0（EP-09 / EH-07，2026-09-15 修复）：**NODE_ENV=production 时 PG_PASSWORD 必填**，
// 缺失即抛错，不再静默回落 `'postgres'`——否则漏配环境变量会带着默认口令启动生产库连接。
export function parseDbConfig(env: NodeJS.ProcessEnv): DbConfig {
  const port = Number(env.PG_PORT ?? 5432)
  const isProduction = env.NODE_ENV === 'production'
  const password = env.PG_PASSWORD ?? (isProduction ? undefined : 'postgres')
  if (!password) {
    throw new Error(
      '启动失败：生产环境（NODE_ENV=production）必须注入 PG_PASSWORD，禁止使用默认口令 postgres'
    )
  }
  return {
    host: env.PG_HOST ?? 'localhost',
    port: Number.isInteger(port) && port > 0 ? port : 5432,
    user: env.PG_USER ?? 'postgres',
    password,
    database: env.PG_DATABASE ?? 'beibu-gulf-data',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  }
}
