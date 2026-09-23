import { describe, expect, it } from 'vitest'

import { MAX_DETAIL_LEN, sanitizeDetail } from '../src/common/utils/sanitize-detail'

// 净化族（日志 sink + 公开响应 sink）判据回归：
// 同类 sink 一共四处（business-error.filter / task-queue ×2 / csp-report / task.service），
// 任一处漏了就等于那条通道没设防，故共用一份实现并逐条钉住行为。
describe('sanitizeDetail', () => {
  it('🔴 换行/制表符压平：匿名输入不得伪造服务端日志行', () => {
    const injected = '第一行\n2026-09-23 ERROR 伪造的服务端日志\r\n第三行\t制表'
    const out = sanitizeDetail(injected)
    expect(out).not.toMatch(/[\r\n\t]/)
    expect(out).toBe('第一行 2026-09-23 ERROR 伪造的服务端日志 第三行 制表')
  })

  it('超长文本按 200 字截断并加省略号（express body 上限 100kb 不得放大成无界日志）', () => {
    const out = sanitizeDetail('x'.repeat(5000))
    expect(out.length).toBe(MAX_DETAIL_LEN + 1) // 200 + '…'
    expect(out.endsWith('…')).toBe(true)
    // 边界：恰好等于上限不截断
    expect(sanitizeDetail('y'.repeat(MAX_DETAIL_LEN)).endsWith('…')).toBe(false)
  })

  it('非字符串归一为字符串；自定义上限生效（csp-report 走自己的 200 但可传参）', () => {
    expect(sanitizeDetail(42)).toBe('42')
    expect(sanitizeDetail({ a: 1 })).toBe('[object Object]')
    expect(sanitizeDetail('abcdef', 3)).toBe('abc…')
  })
})
