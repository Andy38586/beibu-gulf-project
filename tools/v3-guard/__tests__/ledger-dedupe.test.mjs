import { describe, expect, it } from 'vitest'

import { auditLedgers, expandIdList, parseLedgerIds, parseOpenStats } from '../ledger-dedupe.mjs'

// 最小台账文本（行格式对齐真实台账：| 等级 | 编号-标题<br>`discover:…` | 描述 | 记录 |）
const OPEN_OK = `# 待解决问题

| p1 | a001-某问题<br>\`discover:20260922\` | 描述 | 记录 |
| p2 | a002-另一问题<br>\`discover:20260922\` | 描述 | 记录 |

- **真实 open：2 项**（p0 × 0：<br>｜p1 × 1：a001｜p2 × 1：a002｜p3 × 0：<br>）。
`
const SOLVED_OK = `# 已解决问题

| p2 | b001-老问题<br>discover:20260801<br>solve:20260901 | 描述 | 记录 |
`

describe('ledger-dedupe：台账编号唯一性与统计行对账（z041）', () => {
  it('干净台账：无问题、无断档', () => {
    const { problems, gaps } = auditLedgers(OPEN_OK, SOLVED_OK)
    expect(problems).toEqual([])
    expect(gaps).toEqual([])
  })

  it('阳性对照①：台账内重号必红', () => {
    const openDup = OPEN_OK.replace('| p2 | a002-', '| p2 | a001-').replace(
      'p2 × 1：a002',
      'p2 × 1：a001'
    )
    const { problems } = auditLedgers(openDup, SOLVED_OK)
    expect(problems.some((p) => p.includes('重号') && p.includes('a001'))).toBe(true)
  })

  it('阳性对照②：跨台账撞号必红（34e8bf33 事故形态）', () => {
    const solvedDup = SOLVED_OK.replace('b001-', 'a001-')
    const { problems } = auditLedgers(OPEN_OK, solvedDup)
    expect(problems.some((p) => p.includes('跨台账撞号') && p.includes('a001'))).toBe(true)
  })

  it('阳性对照③：统计行与表体不符必红', () => {
    const openBadStats = OPEN_OK.replace('真实 open：2 项', '真实 open：3 项')
    const { problems } = auditLedgers(openBadStats, SOLVED_OK)
    expect(problems.some((p) => p.includes('统计行总数 3 与表体行数 2 不一致'))).toBe(true)
  })

  it('统计行分级 ID 清单与表体成员逐一核对', () => {
    const openWrongMember = OPEN_OK.replace('p2 × 1：a002', 'p2 × 1：a003')
    const { problems } = auditLedgers(openWrongMember, SOLVED_OK)
    expect(problems.some((p) => p.includes('统计行有、表体无：a003'))).toBe(true)
    expect(problems.some((p) => p.includes('表体有、统计行无：a002'))).toBe(true)
  })

  it('断档只报告不拦截（新号优先填最低空号）', () => {
    const openGap = OPEN_OK.replace('| p2 | a002-', '| p2 | a005-').replace(
      'p2 × 1：a002',
      'p2 × 1：a005'
    )
    const { problems, gaps } = auditLedgers(openGap, SOLVED_OK)
    expect(problems).toEqual([])
    expect(gaps.some((g) => g.includes('a002') && g.includes('断档'))).toBe(true)
  })

  it('expandIdList 展开区间（a034-a036/b018 → 4 个 id）', () => {
    expect(expandIdList('a034-a036/b018')).toEqual(['a034', 'a035', 'a036', 'b018'])
    expect(expandIdList('d058')).toEqual(['d058'])
  })

  it('parseLedgerIds 忽略非台账行（统计行/表头/正文）', () => {
    const ids = parseLedgerIds(OPEN_OK)
    expect(ids).toEqual(['a001', 'a002'])
  })

  it('parseOpenStats 解析真实统计行口径', () => {
    const stats = parseOpenStats(OPEN_OK)
    expect(stats.total).toBe(2)
    expect(stats.levels[1]).toEqual({ level: 1, count: 1, ids: ['a001'] })
  })
})
