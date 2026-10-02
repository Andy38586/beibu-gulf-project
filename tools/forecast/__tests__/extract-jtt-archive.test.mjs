import { describe, expect, it } from 'vitest'

import {
  buildTableLines,
  cumDiffCheck,
  normalizeOcrWord,
  tableToLines,
} from '../extract-jtt-archive.mjs'

// JTT 深度提取器单测（2026-10-02）：表格行合成、OCR 几何重建、跨期一致性闸。
// 变异四式取证见提交正文（UNIT_RE 去「力」容错红 / NUM_RE 并字护栏删红 / cum_diff 阈值删红）。

describe('tableToLines（HTML 表格 → 合成行）', () => {
  it('真实 2021-08 行形态：标签/单位/累计/本月 四格拼回一行', () => {
    const html = `<table>
      <tr><td>指标</td><td>计算单位</td><td>自年初累计</td><td>本月</td></tr>
      <tr><td>1.北部湾港</td><td>万吨</td><td>23432</td><td>4634</td></tr>
    </table>`
    expect(tableToLines(html)).toEqual([
      '指标 计算单位 自年初累计 本月',
      '1.北部湾港 万吨 23432 4634',
    ])
  })
})

describe('buildTableLines（OCR 词框几何重建）', () => {
  // 合成词框：y=行中心，x=横向位置；h=字高（决定聚类与并字间隙阈值）
  const W = (t, x, y, w = 30, h = 20) => ({ t, x, y: y + h / 2, h, w })

  it('标签单字并字 + 单位 + 数字格 → 合成行（数字紧邻也不得粘连）', () => {
    const j = {
      lines: [
        {
          words: [
            W('北', 0, 100),
            W('部', 22, 100),
            W('湾', 44, 100),
            W('港', 66, 100),
            W('万吨', 200, 100),
            W('40465', 300, 100),
            W('4311', 342, 100),
            W('13.9', 500, 100),
          ],
        },
      ],
    }
    expect(buildTableLines(j)).toEqual(['北部湾港 万吨 40465 4311 13.9'])
  })

  it('OCR 固定误读「万→力」（力吨/力人）仍是单位行；无单位行丢弃', () => {
    const j = {
      lines: [
        {
          words: [
            W('防', 0, 100),
            W('城', 22, 100),
            W('港', 44, 100),
            W('力吨', 200, 100),
            W('17314', 300, 100),
            W('1791', 342, 100),
          ],
        },
        { words: [W('总计', 0, 200), W('63300', 300, 200)] }, // 无单位 → 丢
      ],
    }
    expect(buildTableLines(j)).toEqual(['防城港 力吨 17314 1791'])
  })

  it('数字格不足 2 个 → 该行丢弃（同比列丢失时不硬凑）', () => {
    const j = {
      lines: [{ words: [W('北部湾港', 0, 100), W('万吨', 200, 100), W('40465', 300, 100)] }],
    }
    expect(buildTableLines(j)).toEqual([])
  })
})

describe('cumDiffCheck（跨期一致性闸：同年相邻月 累计差分 ≈ 本月值）', () => {
  const rec = (year, month, fangCum, fangMonth) => ({
    year,
    month,
    fang_cargo: { cum: fangCum, month: fangMonth },
    qin_cargo: null,
    bei_cargo: null,
    beibu_cargo: null,
  })

  it('差分偏差 >2% → 标记；≤2% → 不标（阈值判据双向）', () => {
    const bad = cumDiffCheck([rec(2021, 5, 10000, 1000), rec(2021, 6, 11000, 1300)])
    // 差分 1000 vs 本月 1300 → 偏差 23% → 必标
    expect(bad).toHaveLength(1)
    const ok = cumDiffCheck([rec(2021, 5, 10000, 1000), rec(2021, 6, 11000, 1000)])
    expect(ok).toHaveLength(0)
  })

  it('缺任一数值（OCR 截断）→ 跳过该条不误标', () => {
    const r = cumDiffCheck([
      rec(2021, 5, 10000, 1000),
      { year: 2021, month: 6, fang_cargo: { cum: 11000, month: null } },
    ])
    expect(r).toHaveLength(0)
  })
})

describe('normalizeOcrWord（全角标点归一）', () => {
  it('全角句点/逗号/负号转半角并去内部空格', () => {
    expect(normalizeOcrWord('15 ． 65')).toBe('15.65')
    expect(normalizeOcrWord('－ 21. 4')).toBe('-21.4')
  })
})
