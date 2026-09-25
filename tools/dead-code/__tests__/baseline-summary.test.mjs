// @vitest-environment node
/**
 * baseline-summary 的自测。
 *
 * 钉三件事：
 *   1) 从真实 `dead-code-baseline.json` 的 history 派生出的「真清理 / 口径调整」
 *      与逐笔差分一致（这是文档那格要引用的数）；
 *   2) **末条 totalDead ≠ 当前基线** ⇒ 必报（抓「改基线没记 history」）；
 *   3) **出现未分类 kind** ⇒ 必报（抓「新类别被并进别的组」）。
 *
 * 为什么不去断言「分类之和 = 净变化」：差分望远镜求和恒等于首末之差，
 * 写出来是永远红不了的假绿壳（本仓 04 明令禁止的那类）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { CLOSING_KINDS, auditHistory, summarize } from '../baseline-summary.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const baselineFile = path.join(HERE, '../dead-code-baseline.json')

/** 真实 history（受版本控制，判据输入不许是手搓的） */
const real = JSON.parse(fs.readFileSync(baselineFile, 'utf8'))

/** 一份同形桩：47 → 35（真清理 −12）→ 29（口径调整 −6）→ 22（真清理 −7） */
const stub = () => [
  { at: 'd1', totalDead: 47, kind: '初值', note: 'init' },
  { at: 'd1', totalDead: 35, kind: '真清理', note: 'a' },
  { at: 'd1', totalDead: 29, kind: '口径调整', note: 'b' },
  { at: 'd1', totalDead: 22, kind: '真清理', note: 'c' },
]

describe('dead-code baseline-summary — 死物账派生', () => {
  it('从真实 history 派生：真清理 / 口径调整 各多少，逐笔可追', () => {
    const { byKind, net, entries } = summarize(real.history)
    expect(entries).toHaveLength(real.history.length - 1)
    // 每笔差分 == 前后两条之差（不许中间插值）
    for (const e of entries) expect(e.delta).toBe(e.to - e.from)
    // 首末之差是净变化
    expect(net).toBe(real.history.at(-1).totalDead - real.history[0].totalDead)
    // 各类别之和 == 逐笔差分之和（同源，不是"对账"）
    expect(Object.values(byKind).reduce((a, b) => a + b, 0)).toBe(net)
    for (const k of Object.keys(byKind)) {
      expect(CLOSING_KINDS, `类别 ${k} 不在口径内，本用例的预期要随之更新`).toContain(k)
    }
  })

  it('真实 history 完整：末条与当前基线一致，类别都在口径内', () => {
    expect(auditHistory(real.history, { baselineTotal: real.totalDead })).toEqual([])
  })

  it('@red-sample 末条 totalDead ≠ 当前基线 ⇒ 必报（改基线没记 history）', () => {
    const problems = auditHistory(stub(), { baselineTotal: 999 })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('没记 history')
  })

  it('@red-sample 出现未分类 kind ⇒ 必报（不许并进别的组）', () => {
    const h = stub()
    h[2].kind = '杂项'
    const problems = auditHistory(h, { baselineTotal: 22 })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('未分类')
  })

  it('@red-sample history 为空 ⇒ 必报', () => {
    expect(auditHistory([], { baselineTotal: 22 })[0]).toContain('无账可算')
  })

  it('桩 history 正常 ⇒ 不报（阳性对照：判据不是恒红）', () => {
    expect(auditHistory(stub(), { baselineTotal: 22 })).toEqual([])
  })
})
