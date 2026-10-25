import { describe, expect, it } from 'vitest'

import { STATES, parseDetailRows } from '../lib/appendix-rows.mjs'

/**
 * F78 回归：状态值域正则段从 STATES 派生（此前手抄 `(A-|A|B|C|D|退役)` 两份口径）。
 * 派生最险的一步是 alternation 序——A- 必须排在 A 前，否则 `A-` 行被截胡成 `A`。
 */
describe('appendix-rows —— 状态值域派生（F78）', () => {
  it('A- 不被 A 前缀截胡（派生正则序的承重用例）', () => {
    const rows = [...parseDetailRows('### 专项9\n| 9.1′ | 名称 | P1 | A- |\n').get('专项9')]
    expect(rows[0].state).toBe('A-')
  })

  it('全部值域值可解析且原样返回（含带转义元的「退役」）', () => {
    const md =
      '### 专项1\n' +
      STATES.map((s, i) => `| 1.${i} | 名称${i} | P${(i % 3) + 1} | ${s} |`).join('\n') +
      '\n'
    const rows = [...parseDetailRows(md).get('专项1')]
    expect(rows.map((r) => r.state)).toEqual(STATES)
  })

  it('@guard-red-sample 值域外的状态不匹配该行（行被丢弃，不误归入其他状态）', () => {
    const rows = [
      ...parseDetailRows('### 专项2\n| 2.1 | 名称 | P1 | X9 |\n| 2.2 | 名称 | P2 | B |\n').get(
        '专项2'
      ),
    ]
    expect(rows.map((r) => r.id)).toEqual(['2.2'])
  })
})
