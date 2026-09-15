import { describe, expect, it } from 'vitest'

import { auditCspSync, extractPolicies, locationsMissingCsp } from '../csp-sync.mjs'

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

// 「注入即红」：nginx add_header 是层级全量替换——每个自带 add_header 的 location 都必须重复 CSP（P1-10）
describe('locationsMissingCsp — 自带 add_header 的 location 必须重复 CSP', () => {
  const server = (body) => `server {\n${CSP(REPORT)}\n${body}\n}`

  it('location 自带 add_header 但未重复 CSP → 命中路径', () => {
    const text = server(`  location /assets/ {\n    add_header Cache-Control "public";\n  }`)
    expect(locationsMissingCsp(text)).toEqual(['/assets/'])
  })

  it('location 自带 add_header 且重复了 CSP → 不命中', () => {
    const text = server(
      `  location /assets/ {\n    add_header Cache-Control "public";\n    ${CSP(REPORT)}\n  }`
    )
    expect(locationsMissingCsp(text)).toEqual([])
  })

  it('location 无 add_header → 正常继承 server 级 CSP，不命中', () => {
    const text = server(`  location /nest-api/ {\n    proxy_pass http://nest:3000;\n  }`)
    expect(locationsMissingCsp(text)).toEqual([])
  })

  it('集成：两份配置"都漏写同一个 location"仍报错（旧实现条数相等 + 逐字一致 → 放行）', () => {
    const text = server(
      `  location /a/ {\n    ${CSP(REPORT)}\n  }\n  location /b/ {\n    add_header X-Foo 1;\n  }`
    )
    const problems = auditCspSync(text, text) // 两份完全相同 → 旧逻辑条数/内容全过
    expect(problems.some((p) => p.includes('/b/'))).toBe(true)
  })
})
