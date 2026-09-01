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

// 开发默认值对齐 docker-compose.v3.yml（postgres/postgres/v3_dev@5432）；
// 生产凭据一律经环境注入，默认口令禁止外溢到生产配置（专项5 指标 8.3，P0）
export function parseDbConfig(env: NodeJS.ProcessEnv): DbConfig {
  const port = Number(env.PG_PORT ?? 5432)
  return {
    host: env.PG_HOST ?? 'localhost',
    port: Number.isInteger(port) && port > 0 ? port : 5432,
    user: env.PG_USER ?? 'postgres',
    password: env.PG_PASSWORD ?? 'postgres',
    database: env.PG_DATABASE ?? 'v3_dev',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  }
}
