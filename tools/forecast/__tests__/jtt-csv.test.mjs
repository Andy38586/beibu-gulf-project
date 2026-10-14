import { describe, expect, it } from 'vitest'

import { toCsv } from '../lib/jtt-csv.mjs'

/**
 * jtt-csv（extract-jtt-archive / fetch-jtt-monthly 共用唯一来源）的能红判据：
 * - 不给 modeOf ⇒ 无 `mode` 列（fetch 形态）；给 modeOf ⇒ `month` 后插 `mode` 列（extract 形态）；
 * - 按 year*100+month 升序；`fetched_at` 取当日。
 * 变异「删 mode 列分支 / 去掉 sort」任一处 ⇒ 对应用例必红。
 */
const rec = (year, month, extra = {}) => ({
  year,
  month,
  source_url: `u${year}${month}`,
  ...extra,
})

const HEAD_NO_MODE = [
  'year',
  'month',
  'cargo_fang_cum_10kt',
  'cargo_fang_month_10kt',
  'cargo_qin_cum_10kt',
  'cargo_qin_month_10kt',
  'cargo_bei_cum_10kt',
  'cargo_bei_month_10kt',
  'cargo_beibu_cum_10kt',
  'cargo_beibu_month_10kt',
  'container_beibu_cum_teu',
  'container_beibu_month_teu',
  'sum_check_pct',
  'source_url',
  'fetched_at',
]

describe('jtt-csv · toCsv 单一来源', () => {
  it('不给 modeOf ⇒ 无 mode 列（fetch-jtt-monthly 形态）', () => {
    const [head, row] = toCsv([rec(2020, 4, { fang_cargo: { cum: 1, month: 2 } })]).split('\n')
    expect(head.split(',')).toEqual(HEAD_NO_MODE)
    expect(row.split(',')[2]).toBe('1') // 第 3 列 = cargo_fang_cum_10kt（无 mode）
  })

  it('给 modeOf ⇒ month 后插 mode 列（extract-jtt-archive 形态）', () => {
    const csv = toCsv([rec(2020, 4, { fang_cargo: { cum: 1, month: 2 } })], (r) => r._mode ?? '')
    const [head, row] = csv.split('\n')
    expect(head.split(',')[2]).toBe('mode')
    expect(row.split(',')[2]).toBe('') // modeOf 默认 ''
    expect(row.split(',')[3]).toBe('1') // 其后 = cargo_fang_cum_10kt
  })

  it('按 year*100+month 升序（乱序输入也排好）', () => {
    const months = toCsv([rec(2020, 4), rec(2016, 6), rec(2020, 1)])
      .split('\n')
      .slice(1)
      .map((l) => l.split(',').slice(0, 2).join('-'))
    expect(months).toEqual(['2016-6', '2020-1', '2020-4'])
  })
})
