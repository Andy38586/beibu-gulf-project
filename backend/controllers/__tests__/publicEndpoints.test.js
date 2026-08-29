/**
 * 分析接口免登录语义回归（2026-08-29 收口 02 §4.5）：
 * 选址分析与灾害评估为纯计算端点，未登录必须可访问（此前挂 authenticate 导致
 * 未登录分析弹「未提供认证令牌」toast + 登录 modal）。本测试锁定：无凭据请求
 * 不得返回 401——业务校验失败（400）与正常计算（200）均为合法形态。
 */
import { afterAll, describe, expect, it } from 'vitest'

// app.js 导入链会触发 middleware/auth.js 的 JWT_SECRET 顶层校验，测试先置位
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-for-public-endpoints-at-least-32-chars'

const mod = await import('../../app.js')
const server = mod.default.listen(0)
const base = `http://127.0.0.1:${server.address().port}`

afterAll(() => {
  server.close()
})

describe('分析接口免登录（未登录无凭据直连）', () => {
  it('POST /api/site-analysis 无凭据 → 不返回 401（参数校验 400 属合法形态）', async () => {
    const res = await fetch(`${base}/api/site-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).not.toBe(401)
  })

  it('POST /api/flood/analysis/disaster 无凭据 → 正常计算 200', async () => {
    const res = await fetch(`${base}/api/flood/analysis/disaster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waterLevel: 2 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.code).toBe(200)
    expect(Array.isArray(body.data.affectedFacilities)).toBe(true)
  })
})
