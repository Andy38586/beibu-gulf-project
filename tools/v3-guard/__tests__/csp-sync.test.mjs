import { describe, expect, it } from 'vitest'

import { auditCspSync, extractPolicies } from '../csp-sync.mjs'

const CSP = (extra = '') =>
  `add_header Content-Security-Policy-Report-Only "default-src 'self'; object-src 'none'${extra}" always;`

const REPORT = '; report-uri /nest-api/csp-report'

describe('CSP 双配置同步守卫（审查 z153）', () => {
  it('extractPolicies 抽出全部策略串', () => {
    expect(extractPolicies(`${CSP()}\n${CSP()}`)).toHaveLength(2)
    expect(extractPolicies('没有 CSP 的文件')).toHaveLength(0)
  })

  it('两文件同数、逐字一致、含上报指令 → 通过', () => {
    const text = `${CSP(REPORT)}\n${CSP(REPORT)}`
    expect(auditCspSync(text, text)).toEqual([])
  })

  it('缺上报指令 → 报错（这是本轮要防的核心失效：Report-Only 无端点 = 收 0 条）', () => {
    const text = `${CSP()}\n${CSP()}`
    const problems = auditCspSync(text, text)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('缺少上报指令')
  })

  it('条数不一致 → 报错（"只改了一份配置"的历史坑）', () => {
    const a = `${CSP(REPORT)}\n${CSP(REPORT)}\n${CSP(REPORT)}`
    const b = `${CSP(REPORT)}`
    const problems = auditCspSync(a, b)
    expect(problems.some((p) => p.includes('条数不一致'))).toBe(true)
  })

  it('同一文件内出现两种不同策略 → 报错（必须单一事实源）', () => {
    const a = `${CSP(REPORT)}\n${CSP(`${REPORT}; img-src 'self'`)}`
    const problems = auditCspSync(a, a)
    expect(problems.some((p) => p.includes('不同的 CSP 策略串'))).toBe(true)
  })

  it('某文件完全没有 CSP 声明 → 报错（防止正则/结构漂移后守卫静默失效）', () => {
    const problems = auditCspSync(`${CSP(REPORT)}`, '空配置')
    expect(problems.some((p) => p.includes('nginx.conf 未找到 CSP 声明'))).toBe(true)
  })
})
