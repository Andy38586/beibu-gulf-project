// @vitest-environment node
/**
 * metrics-tally 的自测（**真红样**）。
 *
 * 前一版红样只证了 `parseDetailRows`（解析器）的行为 —— 五处 `problems.push` 全在顶层，
 * 喂不进违例输入，所以那不是「违例时守卫会红」。本笔把审计主体提成
 * `auditAppendix(markdown, declared)`（两条输入都可注入），红样因此是真的：
 * 喂一份**造假的附录**，断言它报出具体违规文案。
 */
import { describe, expect, it } from 'vitest'

import { auditAppendix, crossCheckConvention, parseConventionCounts } from '../metrics-tally.mjs'
import { countBySpec } from '../../audit-kit/metrics-index.mjs'
import { CONVENTION } from '../../audit-kit/paths.mjs'
import { readFileSync } from 'node:fs'
import { parseDetailRows } from '../lib/appendix-rows.mjs'

/** 造一份 §8 明细段落 */
function appendix(rows) {
  return ['### 专项1', ...rows.map((r) => `| ${r.id} | ${r.name} | P1 | ${r.state} |`)].join('\n')
}

describe('metrics-tally — 附录审计（真红样：违例时守卫必须报）', () => {
  it('专项数对齐时不含「指标数漂移」', () => {
    const { problems } = auditAppendix(appendix([{ id: '1.1', name: 'x', state: 'C' }]), {
      专项1: 1,
    })
    expect(problems.join(' ')).not.toContain('指标数漂移')
  })

  it('@guard-red-sample 指标数漂移（声明 57、实际 1）→ 必报', () => {
    const { problems } = auditAppendix(appendix([{ id: '1.1', name: 'x', state: 'C' }]), {
      专项1: 57,
    })
    expect(problems.join(' ')).toContain('指标数漂移')
  })

  it('@guard-red-sample 指标编号重复 → 必报', () => {
    const { problems } = auditAppendix(
      appendix([
        { id: '1.1', name: 'x', state: 'C' },
        { id: '1.1', name: 'y', state: 'C' },
      ]),
      { 专项1: 2 }
    )
    expect(problems.join(' ')).toContain('指标编号重复')
  })

  it('@guard-red-sample 总数漂移（两专项声明和 ≠ 实际）→ 必报', () => {
    const { problems } = auditAppendix('### 专项1\n| 1.1 | x | P1 | C |\n', {
      专项1: 1,
      专项2: 5,
    })
    expect(problems.join(' ')).toContain('指标总数漂移')
  })

  it('解析器可单测（保留）', () => {
    const rows = parseDetailRows('### 专项1\n| 1.1 | 名称 | P1 | C |\n')
    expect(rows.get('专项1')).toEqual([{ id: '1.1', name: '名称', level: 'P1', state: 'C' }])
  })

  it('带 ′ 后缀的追加编号也认（v3 尾部追加）', () => {
    expect(parseDetailRows('### 专项8\n| 8.1′ | 增补 | P2 | A- |\n').get('专项8')?.[0]?.id).toBe(
      '8.1′'
    )
  })
})

describe('metrics-tally — 约定 §3 计数对账（快照可以被留，但必须被断言）', () => {
  const CONV = `| 一级质量属性 | 专项 | 文件 | 指标数 |
| --- | --- | --- | --- |
| 1 架构与模块边界 | 专项6 | \`专项6-架构耦合审查.md\` | 49 |
| 5 **算法与结果正确性** | **专项8（2026-08-11 新建）** | \`专项8.md\` | 49 |
| 7 工程化与生产风险 | 专项5 | \`专项5-工程化审查.md\` | 56 |
| 9 **地理分析科学严谨性** | **专项9（试用，标准库待建）** | 尚无文件 | 0（待建） |
`

  it('解析：认带 ** 标记的行，跳过无纯数字计数的行', () => {
    const m = parseConventionCounts(CONV)
    expect([...m.keys()].sort()).toEqual(['专项5', '专项6', '专项8'])
    expect(m.get('专项8')).toBe(49)
    expect(m.has('专项9')).toBe(false)
  })

  it('真红样：表内数与正文派生数不同 ⇒ 报漂移（改正文不改本表即红）', () => {
    const p = crossCheckConvention(parseConventionCounts(CONV), { 专项5: 63, 专项6: 49, 专项8: 49 })
    expect(p).toEqual(['约定 §3 专项5 计数漂移：表内 56，正文 63'])
  })

  it('真红样：正文有该专项而表内无行 ⇒ 报缺行；表内多出行 ⇒ 报多出', () => {
    const only = crossCheckConvention(parseConventionCounts(CONV), { 专项1: 57 })
    expect(only.filter((p) => p.includes('缺 专项1'))).toEqual([
      '约定 §3 缺 专项1 行（正文 57 条）',
    ])
    const extra = crossCheckConvention(
      parseConventionCounts(CONV + '| 9 别的 | 专项9x | `x` | 5 |\n| 8 域 | 专项7 | `y` | 45 |\n'),
      { 专项5: 56, 专项6: 49, 专项7: 45, 专项8: 49 }
    )
    expect(extra.join('|')).toContain('约定 §3 多出')
  })

  it('一致时不许误红（等价重构不误红那一格）', () => {
    const ok = crossCheckConvention(parseConventionCounts(CONV), {
      专项5: 56,
      专项6: 49,
      专项8: 49,
    })
    expect(ok).toEqual([])
  })

  it('真实仓库：约定 §3 与正文派生计数当前必须一致（漂移即拦下提交）', () => {
    const conv = parseConventionCounts(readFileSync(CONVENTION, 'utf8'))
    const declared = countBySpec()
    expect(crossCheckConvention(conv, declared)).toEqual([])
    expect(conv.get('专项5')).toBe(declared['专项5'])
  })
})
