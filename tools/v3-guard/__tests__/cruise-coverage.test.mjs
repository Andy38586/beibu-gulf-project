import { describe, expect, it } from 'vitest'

import { auditCoverage, parseRuleModules } from '../cruise-coverage.mjs'

// 最小 cruise 配置文本（规则命名约定：business-cross-import-<目录名>）
const CRUISE_OK = `
forbidden: [
  { name: 'business-cross-import-flood-analysis', from: { path: '^frontend/src/business/flood-analysis/' } },
  { name: 'business-cross-import-forecast', from: { path: '^frontend/src/business/forecast/' } },
]
`

describe('cruise-coverage：04-E2 规则集合 == 目录集合（z055）', () => {
  it('目录与规则一一对应时无问题', () => {
    const { problems, rules } = auditCoverage(CRUISE_OK, ['flood-analysis', 'forecast'])
    expect(problems).toEqual([])
    expect(rules).toEqual(['flood-analysis', 'forecast'])
  })

  it('阳性对照①：新增业务目录未建规则必红（route-analysis 落地即无守护的回归形态）', () => {
    const { problems } = auditCoverage(CRUISE_OK, ['flood-analysis', 'forecast', 'route-analysis'])
    expect(problems.some((p) => p.includes('business/route-analysis 无互引守护规则'))).toBe(true)
  })

  it('阳性对照②：规则指向不存在的目录（幽灵规则）必红', () => {
    const { problems } = auditCoverage(CRUISE_OK, ['flood-analysis', 'forecast', 'site-selection'])
    expect(
      problems.some((p) => p.includes('幽灵规则') || p.includes('site-selection 无互引守护规则'))
    ).toBe(true)
  })

  it('规则名与 from 路径不一致时抛错（命名约定被破坏）', () => {
    const bad = CRUISE_OK.replace(
      "name: 'business-cross-import-flood-analysis'",
      "name: 'business-cross-import-flood'"
    )
    expect(() => parseRuleModules(bad)).toThrow(/命名约定/)
  })
})
