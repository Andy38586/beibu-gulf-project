// @vitest-environment node
/**
 * metrics-tally 的自测（含红样）。
 *
 * 该守卫此前逻辑全在顶层（读真实附录），喂不了违例输入。本笔把 §8 明细表的解析提成
 * `parseDetailRows(markdown)`（文本可注入），红样因此可写。
 *
 * 顺带钉住一处**隐藏行为**：状态列的正则已写成 `(A-|A|B|C|D|退役)`，所以
 * 「状态非法」那条 problems 分支**永不触发** —— 非法值在解析层就被丢弃，不会报错。
 * 下面第二条用例把这个事实固化下来：若将来放宽正则，它会失败，提醒补上真正的校验。
 */
import { describe, expect, it } from 'vitest'

import { parseDetailRows } from '../metrics-tally.mjs'

describe('metrics-tally — 附录 §8 明细表解析', () => {
  it('正常行被解析', () => {
    const rows = parseDetailRows('### 专项1\n| 1.1 | 名称 | P1 | C |\n')
    expect(rows.get('专项1')).toEqual([{ id: '1.1', name: '名称', level: 'P1', state: 'C' }])
  })

  it('@guard-red-sample 非法状态值在解析层被丢弃 ⇒ 「状态非法」分支是死代码（放宽正则会红）', () => {
    const rows = parseDetailRows('### 专项1\n| 1.1 | 名称 | P1 | Z |\n')
    expect(rows.get('专项1') ?? []).toHaveLength(0)
  })

  it('@guard-red-sample 带 ′ 后缀的追加编号也认（v3 尾部追加）', () => {
    const rows = parseDetailRows('### 专项8\n| 8.1′ | 增补项 | P2 | A- |\n')
    expect(rows.get('专项8')?.[0]?.id).toBe('8.1′')
  })

  it('无匹配行 → 空表（不静默造数据）', () => {
    expect([...parseDetailRows('# 无关文档').keys()]).toEqual([])
  })
})
