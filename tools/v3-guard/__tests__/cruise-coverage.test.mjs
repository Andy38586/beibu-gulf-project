import { describe, expect, it } from 'vitest'

import { auditCoverage, parseRuleModules } from '../cruise-coverage.mjs'

// 最小 cruise 配置**对象**（规则命名约定：business-cross-import-<目录名>）。
// W11 起对账读 require() 出来的真实配置对象，故 fixture 也必须是对象——
// 文本 fixture 会让"注释里的规则名"重新变成可命中项。
const CRUISE_OK = {
  forbidden: [
    {
      name: 'business-cross-import-flood-analysis',
      from: { path: '^frontend/src/business/flood-analysis/' },
      to: { pathNot: '^frontend/src/business/flood-analysis/' },
    },
    {
      name: 'business-cross-import-forecast',
      from: { path: '^frontend/src/business/forecast/' },
      to: { pathNot: '^frontend/src/business/forecast/' },
    },
  ],
}

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
    const bad = {
      forbidden: [
        {
          name: 'business-cross-import-flood',
          from: { path: '^frontend/src/business/flood-analysis/' },
        },
      ],
    }
    expect(() => parseRuleModules(bad)).toThrow(/命名约定/)
  })

  it('🔴 不再数注释里的规则名：规则只剩在注释文本里即在册（W11）', () => {
    // 旧实现读配置**文本**做正则 ⇒ 规则名留在注释里照样命中，规则真被停用也不红。
    const commentedOut = {
      comment:
        "// { name: 'business-cross-import-forecast', from: { path: '^frontend/src/business/forecast/' } }",
      forbidden: CRUISE_OK.forbidden.slice(0, 1), // forecast 那条已从真实配置里拿掉
    }
    expect(parseRuleModules(commentedOut)).toEqual(['flood-analysis'])
    const { problems } = auditCoverage(commentedOut, ['flood-analysis', 'forecast'])
    expect(problems.some((p) => p.includes('business/forecast 无互引守护规则'))).toBe(true)
  })
})
