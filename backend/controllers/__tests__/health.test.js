// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

// 导入 app.js 会间接触发 middleware/auth.js 的模块顶层校验（JWT_SECRET）。
// 测试环境需先置位一个测试用密钥，避免 import 时抛 FATAL。
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-for-health-at-least-32-chars-xxxxxxxxx'

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }
}

describe('health - readiness (d063)', () => {
  it('正常：数据目录可读 → 200 ready', async () => {
    const mod = await import('../../app.js')
    const res = mockRes()
    await mod.readinessHandler({}, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(200)
    const body = res.json.mock.calls[0][0]
    expect(body.status).toBe('ready')
    expect(body.checks.dataDir).toBe(true)
  })

  it('降级：数据目录不可读 → 503 degraded', async () => {
    // 通过 mock fs/promises 让 readdir 失败，验证 readiness 返回 503
    vi.doMock('fs/promises', () => ({
      readdir: vi.fn().mockRejectedValue(new Error('ENOENT')),
    }))
    vi.resetModules()
    const mod = await import('../../app.js')
    const res = mockRes()
    await mod.readinessHandler({}, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(503)
    const body = res.json.mock.calls[0][0]
    expect(body.status).toBe('degraded')
    expect(body.checks.dataDir).toBe(false)
  })
})
