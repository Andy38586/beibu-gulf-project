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

import { auditAppendix, parseDetailRows } from '../metrics-tally.mjs'

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
