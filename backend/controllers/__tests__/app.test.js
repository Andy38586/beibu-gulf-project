// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * trust proxy 配置。
 * 原 `Number(process.env.TRUST_PROXY_HOPS) || 1` 对 "0" 失效（Number("0")=0 为 falsy → 回落 1），
 * 无法表达"不信任代理"。改为显式判断非负有限值。
 * 通过动态 import + 每次重置模块来隔离不同环境变量下的取值。
 * 注意：本文件位于 backend/controllers/__tests__/，app.js 在 backend/ 根，故相对路径为 ../../app.js。
 * 导入 app.js 会间接触发 middleware/auth.js 的模块顶层校验（JWT_SECRET）。
 * 测试环境需先置位一个测试用密钥，避免 import 时抛 FATAL（与 REQ-6 逻辑无关）。
 */
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-for-req6-at-least-32-chars-xxxxxxxxxx'

describe('app - trust proxy (REQ-6)', () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY_HOPS
    vi.resetModules()
  })

  it('TRUST_PROXY_HOPS=0 → trust proxy 为 0', async () => {
    process.env.TRUST_PROXY_HOPS = '0'
    vi.resetModules()
    const mod = await import('../../app.js')
    expect(mod.default.get('trust proxy')).toBe(0)
  })

  it('未设置 → trust proxy 默认 1', async () => {
    delete process.env.TRUST_PROXY_HOPS
    vi.resetModules()
    const mod = await import('../../app.js')
    expect(mod.default.get('trust proxy')).toBe(1)
  })

  it('合法跳数 2 → trust proxy 为 2', async () => {
    process.env.TRUST_PROXY_HOPS = '2'
    vi.resetModules()
    const mod = await import('../../app.js')
    expect(mod.default.get('trust proxy')).toBe(2)
  })
})

/**
 * 限流分层验证（预测播放高频请求 → forecast 接口豁免全局限流）。
 * 全局 limiter(max 1000/15min，2026-08-09 演示放宽) 对 /api/forecast/* 走 skip
 * （用 originalUrl 判断，注意 app.use('/api/',...) 内 req.path 已去掉 /api/ 前缀）；
 * forecast 接口由专属 forecastLimiter(max 1000/15min) 管理。
 */
describe('app - 限流分层（forecast 豁免全局）', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('forecast 接口 101 连发不触发全局限流（skip 生效）', async () => {
    const mod = await import('../../app.js')
    const server = mod.default.listen(0)
    const base = `http://127.0.0.1:${server.address().port}`
    try {
      let lastStatus = 0
      for (let i = 0; i < 101; i++) {
        const res = await fetch(`${base}/api/forecast/overview`)
        lastStatus = res.status
        if (lastStatus === 429) break
      }
      expect(lastStatus).not.toBe(429)
    } finally {
      server.close()
    }
  }, 30000)

  it('非 forecast 接口 1001 连发触发全局限流 429（演示阈值 1000/15min）', async () => {
    const mod = await import('../../app.js')
    const server = mod.default.listen(0)
    const base = `http://127.0.0.1:${server.address().port}`
    try {
      let lastStatus = 0
      for (let i = 0; i < 1001; i++) {
        const res = await fetch(`${base}/api/ports`)
        lastStatus = res.status
        if (lastStatus === 429) break
      }
      expect(lastStatus).toBe(429)
    } finally {
      server.close()
    }
  }, 60000)
})
