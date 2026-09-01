import { describe, expect, it } from 'vitest'

import { parseDbConfig } from '../src/infra/db/db.config'

describe('parseDbConfig', () => {
  it('无环境变量时回落到 docker-compose.v3.yml 的开发默认值', () => {
    const cfg = parseDbConfig({})
    expect(cfg).toEqual({
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'v3_dev',
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  })

  it('环境变量完整覆盖默认值', () => {
    const cfg = parseDbConfig({
      PG_HOST: 'db.internal',
      PG_PORT: '6543',
      PG_USER: 'beibu',
      PG_PASSWORD: 'secret',
      PG_DATABASE: 'prod_db',
    })
    expect(cfg.host).toBe('db.internal')
    expect(cfg.port).toBe(6543)
    expect(cfg.user).toBe('beibu')
    expect(cfg.password).toBe('secret')
    expect(cfg.database).toBe('prod_db')
  })

  it('非法端口（非数字/负数/非整数）回退 5432', () => {
    expect(parseDbConfig({ PG_PORT: 'abc' }).port).toBe(5432)
    expect(parseDbConfig({ PG_PORT: '-1' }).port).toBe(5432)
    expect(parseDbConfig({ PG_PORT: '5432.7' }).port).toBe(5432)
  })

  it('连接池参数为任务卡约定值（max 10 / idle 30s / connect 5s）', () => {
    const cfg = parseDbConfig({ PG_HOST: 'x' })
    expect(cfg.max).toBe(10)
    expect(cfg.idleTimeoutMillis).toBe(30000)
    expect(cfg.connectionTimeoutMillis).toBe(5000)
  })
})
