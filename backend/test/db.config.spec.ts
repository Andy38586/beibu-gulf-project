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
      database: 'beibu-gulf-data',
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

  // P0（EP-09/EH-07）生产口令 fail-fast 的【最近层】直测：不允许只靠 ConfigService 间接兜底。
  // 变异探针 M8 会拆掉这道闸，这些断言必须随之变红（约束成立的可执行证据）。
  describe('生产环境（NODE_ENV=production）PG_PASSWORD 强校验', () => {
    it('生产缺 PG_PASSWORD → 直接抛错，禁止静默回落默认口令 postgres', () => {
      expect(() => parseDbConfig({ NODE_ENV: 'production' })).toThrow(/PG_PASSWORD/)
    })
    it('生产给空串 PG_PASSWORD → 同样抛错（空串等同未注入）', () => {
      expect(() => parseDbConfig({ NODE_ENV: 'production', PG_PASSWORD: '' })).toThrow(
        /PG_PASSWORD/
      )
    })
    it('生产显式注入口令 → 正常采用、不抛错', () => {
      const cfg = parseDbConfig({ NODE_ENV: 'production', PG_PASSWORD: 'a-strong-secret' })
      expect(cfg.password).toBe('a-strong-secret')
    })
    it('非生产（development/缺省）保留开发默认口令 postgres，不受生产闸影响', () => {
      expect(parseDbConfig({ NODE_ENV: 'development' }).password).toBe('postgres')
      expect(parseDbConfig({}).password).toBe('postgres')
    })
  })
})
