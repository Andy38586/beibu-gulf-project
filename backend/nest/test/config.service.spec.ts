import { describe, expect, it } from 'vitest'

import { ConfigService, resolveDataDir } from '../src/infra/config/config.service'

describe('ConfigService', () => {
  it('无环境变量时 port 回落 3100、nodeEnv 回落 development', () => {
    const config = new ConfigService({})
    expect(config.port).toBe(3100)
    expect(config.nodeEnv).toBe('development')
    expect(config.isProduction).toBe(false)
  })

  it('PORT/NODE_ENV 经环境覆盖（Number 语义与迁移前 main.ts 一致）', () => {
    const prod = new ConfigService({ PORT: '3200', NODE_ENV: 'production' })
    expect(prod.port).toBe(3200)
    expect(prod.isProduction).toBe(true)
    expect(new ConfigService({ PORT: 'abc' }).port).toBe(3100)
    expect(new ConfigService({ PORT: '' }).port).toBe(3100)
  })

  it('dbConfig 经 parseDbConfig 聚合（PG_* 覆盖生效）', () => {
    const config = new ConfigService({ PG_HOST: 'db.internal', PG_PORT: '6543' })
    expect(config.dbConfig.host).toBe('db.internal')
    expect(config.dbConfig.port).toBe(6543)
  })

  it('DATA_DIR 优先作为数据目录', () => {
    expect(resolveDataDir({ DATA_DIR: '/tmp/beibu-data' })).toMatch(/[\\/]tmp[\\/]beibu-data/)
  })

  it('jwtSecret 出口与 jwt.util 强校验同源：缺 JWT_SECRET 抛错', () => {
    expect(() => new ConfigService({}).jwtSecret).toThrow(/JWT_SECRET/)
    expect(() => new ConfigService({}).validateStartup()).toThrow(/JWT_SECRET/)
  })
})
