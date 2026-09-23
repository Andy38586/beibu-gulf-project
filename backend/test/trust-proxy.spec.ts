import express from 'express'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveTrustProxyHops } from '../src/common/utils/trust-proxy'

// d058 接线回归闸：**行为断言**，不再是源码子串匹配。
// 起因（R4-02 §4 PC-A~PC-C 实测）：原写法 `expect(MAIN_TS).toMatch(/http\.set\(…/)` 对
// 「把调用行注释掉」（PC-A）与「把调用行包进 if (NODE_ENV === 'development')」（PC-C）
// 都看不见（两种都实测 4 passed 假绿），却对语义等价的局部变量重构误红（PC-B）。
// 改为真跑一次 bootstrap（NestFactory 打桩，不起真服务、不连库），直接断言 Express 实例上的
// trust proxy 真值——控制流没走到那行就必红。
const stub = vi.hoisted(() => ({
  expressApp: undefined as unknown as express.Express,
  config: undefined as unknown as object,
  configClass: undefined as unknown as object,
  listenCalls: 0,
}))

// app.module 是整棵 DI 图的入口，本件只关心 bootstrap 的控制流，故打桩
vi.mock('../src/app.module', () => ({ AppModule: class AppModuleStub {} }))
// SwaggerModule 只在非生产分支被调用，其 createDocument/setup 依赖真 adapter，一并打桩
vi.mock('@nestjs/swagger', () => ({
  DocumentBuilder: class {
    setTitle = () => this
    setDescription = () => this
    setVersion = () => this
    build = () => ({})
  },
  SwaggerModule: { createDocument: () => ({}), setup: () => {} },
}))
vi.mock('@nestjs/core', () => ({
  NestFactory: {
    create: async () => ({
      getHttpAdapter: () => ({ getInstance: () => stub.expressApp }),
      get: (token: unknown) => (token === stub.configClass ? stub.config : undefined),
      setGlobalPrefix: () => {},
      use: () => {},
      listen: async () => {
        stub.listenCalls += 1
      },
    }),
  },
}))

// 生产必填项（PG_*/JWT_SECRET）齐备的基线环境；JWT_SECRET 走 process.env 是 jwt.util 的既有口径
const PROD_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  PG_HOST: 'postgres',
  PG_USER: 'postgres',
  PG_PASSWORD: 'not-the-default',
  PG_DATABASE: 'beibu-gulf-data',
}

let savedJwtSecret: string | undefined
beforeEach(() => {
  savedJwtSecret = process.env.JWT_SECRET
  process.env.JWT_SECRET = 'a'.repeat(48)
  // 关掉 main.ts 的自动执行（见 main.ts 导出处的说明），改由用例自己 await bootstrap()
  process.env.VITEST = 'true'
})
afterEach(() => {
  if (savedJwtSecret === undefined) delete process.env.JWT_SECRET
  else process.env.JWT_SECRET = savedJwtSecret
})

// 每个用例一份干净的模块表：bootstrap 只能跑一次，且要用不同 env 重跑
async function loadBootstrap(env: NodeJS.ProcessEnv) {
  vi.resetModules()
  stub.expressApp = express()
  stub.listenCalls = 0
  const { ConfigService } = await import('../src/infra/config/config.service')
  stub.configClass = ConfigService
  stub.config = new ConfigService(env)
  const { bootstrap } = await import('../src/main')
  return bootstrap
}

// 预热：首个 import 要现转 main.ts 的依赖图（express/@nestjs 全链），本机实测 ~10s，
// 不预热则首条用例直接撞 vitest 默认 5s 超时（按行为判红，不是真的接线断了）
beforeAll(async () => {
  await loadBootstrap({ ...PROD_ENV, TRUST_PROXY_HOPS: '1' })
}, 120_000)

// 行为用例都要走一次完整 import + bootstrap，给足余量（CI 冷缓存更慢）
const CASE_TIMEOUT = 30_000

// trust proxy 跳数解析。老 Express 时代有 app.test.js 的
// describe('app - trust proxy (REQ-6)')；Nest 迁移时丢失，本件补解析层用例。
describe('resolveTrustProxyHops（d058）', () => {
  it('缺省/非法值回落 1（nginx→nest 一跳）', () => {
    expect(resolveTrustProxyHops(undefined)).toBe(1)
    expect(resolveTrustProxyHops('')).toBe(1) // Number('') 是 0，空串按未设置
    expect(resolveTrustProxyHops('  ')).toBe(1)
    expect(resolveTrustProxyHops('abc')).toBe(1)
    expect(resolveTrustProxyHops('-1')).toBe(1)
    expect(resolveTrustProxyHops('Infinity')).toBe(1)
  })

  it('0 = 显式不信任代理（不能被 || 1 吞掉）', () => {
    expect(resolveTrustProxyHops('0')).toBe(0)
  })

  it('显式正整型跳数原样生效', () => {
    expect(resolveTrustProxyHops('1')).toBe(1)
    expect(resolveTrustProxyHops('2')).toBe(2)
  })
})

describe('trust proxy 接线与启动断言（d058 行为面）', () => {
  it(
    '生产：跳数真的落到 Express 实例上（注释掉调用行/包 dev 门控必红）',
    async () => {
      const bootstrap = await loadBootstrap({ ...PROD_ENV, TRUST_PROXY_HOPS: '1' })
      await bootstrap()
      expect(stub.expressApp.get('trust proxy')).toBe(1)
      expect(stub.listenCalls).toBe(1)
    },
    CASE_TIMEOUT
  )

  it(
    '生产：跳数取自 env（两级反代 → 2）',
    async () => {
      const bootstrap = await loadBootstrap({ ...PROD_ENV, TRUST_PROXY_HOPS: '2' })
      await bootstrap()
      expect(stub.expressApp.get('trust proxy')).toBe(2)
    },
    CASE_TIMEOUT
  )

  it(
    '生产：缺失/0/非法跳数 → listen 前抛错（启动必红）',
    async () => {
      for (const hops of [undefined, '', '0', '-1', 'abc', '1.5']) {
        const bootstrap = await loadBootstrap({ ...PROD_ENV, TRUST_PROXY_HOPS: hops })
        await expect(bootstrap()).rejects.toThrow(/TRUST_PROXY_HOPS/)
        expect(stub.listenCalls).toBe(0)
      }
    },
    CASE_TIMEOUT
  )

  it(
    '开发：不注入跳数即可启动（本地直连无 nginx），0 仍表示不信任代理',
    async () => {
      const bootstrap = await loadBootstrap({ NODE_ENV: 'development', TRUST_PROXY_HOPS: '0' })
      await bootstrap()
      expect(stub.expressApp.get('trust proxy')).toBe(0)
      expect(stub.listenCalls).toBe(1)
    },
    CASE_TIMEOUT
  )
})
