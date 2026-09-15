import { describe, expect, it } from 'vitest'

import { crossCheckSummary } from '../lib/summary-crosscheck.mjs'

const SUMMARY = [{ 专项: '专项1', 总数: 57, A: 0, B: 0, 'A-': 0, C: 57, D: 0, 退役: 0 }]

describe('crossCheckSummary — §4 汇总表 ↔ §8 明细表（P1-08 壳化修复的可执行证据）', () => {
  it('真实表结构（专项名与序号之间有竖线）能被匹配——原正则对真实表恒不命中', () => {
    const lines = [
      '| 专项1 | 数据链     | 57   | 0     | 0     | 0        | 57    | 0     | 0    |',
    ]
    const { problems, matched } = crossCheckSummary(lines, SUMMARY)
    expect(matched).toBe(1)
    expect(problems).toEqual([])
  })

  it('表内数字与明细不一致 → 报错', () => {
    const lines = ['| 专项1 | 数据链 | 57 | 1 | 0 | 0 | 56 | 0 | 0 |']
    const { problems } = crossCheckSummary(lines, SUMMARY)
    expect(problems.some((p) => p.includes('不一致'))).toBe(true)
  })

  it('匹配不到任何行 → 报错（禁止"解析不到 = 通过"）', () => {
    const { problems, matched } = crossCheckSummary(['| 专项1 数据链 | 57 | 0 |'], SUMMARY)
    expect(matched).toBe(0)
    expect(problems.some((p) => p.includes('未解析到任何专项行'))).toBe(true)
  })

  it('空输入 → 同样报错（不得静默通过）', () => {
    expect(crossCheckSummary([], SUMMARY).problems).toHaveLength(1)
  })

  it('表内专项名与 summary 对不上 → 计为未命中（不假装校验过）', () => {
    const lines = ['| 专项9 | 幽灵 | 1 | 0 | 0 | 0 | 1 | 0 | 0 |']
    expect(crossCheckSummary(lines, SUMMARY).matched).toBe(0)
  })
})
