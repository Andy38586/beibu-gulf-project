import { describe, expect, it } from 'vitest'

import { ConfigService, resolveDataDir } from '../src/infra/config/config.service'

describe('ConfigService', () => {
  it('无环境变量时 port 回落 3000、nodeEnv 回落 development', () => {
    const config = new ConfigService({})
    expect(config.port).toBe(3000)
    expect(config.nodeEnv).toBe('development')
    expect(config.isProduction).toBe(false)
  })

  it('PORT/NODE_ENV 经环境覆盖（Number 语义与迁移前 main.ts 一致）', () => {
    const prod = new ConfigService({
      PORT: '3200',
      NODE_ENV: 'production',
      // P0（EP-09）：生产环境 PG 凭据必填，测试需显式注入
      PG_HOST: 'postgis',
      PG_USER: 'postgres',
      PG_PASSWORD: 'secret',
      PG_DATABASE: 'beibu-gulf-data',
    })
    expect(prod.port).toBe(3200)
    expect(prod.isProduction).toBe(true)
    expect(new ConfigService({ PORT: 'abc' }).port).toBe(3000)
    expect(new ConfigService({ PORT: '' }).port).toBe(3000)
  })

  it('P0（EP-09）：生产环境缺 PG_PASSWORD 直接抛错，不再静默回落默认口令', () => {
    // 构造期即拦截（parseDbConfig 强校验）
    expect(() => new ConfigService({ NODE_ENV: 'production' })).toThrow(/PG_PASSWORD/)
    // validateStartup 亦对四项 PG 配置做显式断言（fail fast 于 listen 前）。
    // 注：validateStartup 先校验 JWT_SECRET，而 getJwtSecret() 直读 process.env（不经注入环境），
    // 故此处临时设 process.env.JWT_SECRET 才能触达 PG 断言分支。
    const prevSecret = process.env.JWT_SECRET
    process.env.JWT_SECRET = 'x'.repeat(32)
    try {
      expect(() =>
        new ConfigService({ NODE_ENV: 'production', PG_PASSWORD: 'secret' }).validateStartup()
      ).toThrow(/PG_HOST|PG_USER|PG_DATABASE/)
    } finally {
      if (prevSecret === undefined) delete process.env.JWT_SECRET
      else process.env.JWT_SECRET = prevSecret
    }
    // 开发环境保留开发默认值，不受影响
    expect(new ConfigService({}).dbConfig.password).toBe('postgres')
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
