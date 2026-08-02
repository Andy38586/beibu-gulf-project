// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * REQ-6（阶段2）: trust proxy 配置。
 * 原 `Number(process.env.TRUST_PROXY_HOPS) || 1` 对 "0" 失效（Number("0")=0 为 falsy → 回落 1），
 * 无法表达"不信任代理"。改为显式判断非负有限值。
 * 通过动态 import + 每次重置模块来隔离不同环境变量下的取值。
 * 注意：本文件位于 backend/controllers/__tests__/，app.js 在 backend/ 根，故相对路径为 ../../app.js。
 *
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
