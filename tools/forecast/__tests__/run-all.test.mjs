// L6 一键入口（run-all.mjs）的纯函数判据。
//
// 这些判据的共同点：**全部由输入/产物结构派生**，不得写成手写清单——
// 否则"新增一港/一个模型"就会静默漏进报告（协议 §七-7 的化身）。
import { describe, expect, it } from 'vitest'

import {
  buildFieldMap,
  determinismVerdict,
  md5Of,
  monthRangeOf,
  renderReport,
} from '../run-all.mjs'

const FIXTURE = {
  ports: {
    testport: {
      backtest: {
        selected_model: 'linear',
        validation_overall_mape: 7.5,
        rolling_mape_by_step: { 1: 5, 2: 6 },
        correction_factor: 1.02,
      },
      model_comparison: {
        linear: { overall_mape: 6.2, overall_mase: 0.8, overall_smape: 5.5 },
        ets_damped: { overall_mape: 9.1, overall_mase: 1.2 },
        dm_vs_linear: { seasonal_naive: { dm: -2.5, p: 0.04, n: 100 } },
      },
    },
  },
}

describe('monthRangeOf：从 JSON 文本派生月份范围', () => {
  it('取 min/max 与出现次数（不猜结构）', () => {
    expect(monthRangeOf('{"a":"2021-01","b":"2026-09","c":"2023-05"}')).toEqual({
      from: '2021-01',
      to: '2026-09',
      count: 3,
    })
  })

  it('无 YYYY-MM 字面量 ⇒ null（阴性对照）', () => {
    expect(monthRangeOf('{"a":1}')).toBeNull()
  })
})

describe('md5Of：内容变则指纹变（阳性对照）', () => {
  it('同内容稳定、异内容不同', () => {
    expect(md5Of('same')).toBe(md5Of('same'))
    expect(md5Of('a')).not.toBe(md5Of('b'))
  })
})

describe('buildFieldMap：映射行由产物结构派生', () => {
  it('覆盖模型对比 / 选中模型 / 验证期 / 逐步长 / 校正系数', () => {
    const fields = buildFieldMap(FIXTURE, 'x.json').map((r) => r.field)
    expect(fields).toContain('x.json → ports.testport.model_comparison.linear.overall_mape')
    expect(fields).toContain('x.json → ports.testport.model_comparison.linear.overall_smape')
    expect(fields).toContain('x.json → ports.testport.model_comparison.ets_damped.overall_mase')
    expect(fields).toContain(
      'x.json → ports.testport.model_comparison.dm_vs_linear.seasonal_naive.p'
    )
    expect(fields).toContain('x.json → ports.testport.backtest.selected_model')
    expect(fields).toContain('x.json → ports.testport.backtest.validation_overall_mape')
    expect(fields).toContain('x.json → ports.testport.backtest.rolling_mape_by_step.2')
    expect(fields).toContain('x.json → ports.testport.backtest.correction_factor')
  })

  it('港口/模型翻倍 ⇒ 行数翻倍（证明不是手写清单）', () => {
    const one = buildFieldMap(FIXTURE, 'x.json').length
    const two = buildFieldMap(
      { ports: { ...FIXTURE.ports, secondport: FIXTURE.ports.testport } },
      'x.json'
    ).length
    expect(two).toBe(one * 2)
  })

  it('空产物 ⇒ 空映射（不抛错）', () => {
    expect(buildFieldMap({ ports: {} }, 'x.json')).toEqual([])
  })
})

describe('determinismVerdict：不许把"变化"说成"一致"', () => {
  const A = (md5) => ({ file: 'a.json', md5 })
  const B = (md5) => ({ file: 'b.json', md5 })

  it('无变化 ⇒ 逐字节一致（且不出现 ⚠️）', () => {
    const s = determinismVerdict([A('1'), B('2')], [A('1'), B('2')])
    expect(s).toContain('逐字节一致')
    expect(s).not.toContain('⚠️')
  })

  it('有变化 ⇒ 必须点名该文件（阳性对照的另一半）', () => {
    const s = determinismVerdict([A('1'), B('2')], [A('1'), B('3')])
    expect(s).toContain('⚠️')
    expect(s).toContain('b.json')
    expect(s).not.toContain('逐字节一致')
  })

  it('交集之外的产物不误报（缺文件不算"变化"）', () => {
    expect(determinismVerdict([A('1')], [])).toContain('逐字节一致')
    expect(determinismVerdict([A('1')], [A('2')])).toContain('⚠️')
  })
})

describe('renderReport：报告必须带指纹与映射表', () => {
  const report = renderReport({
    sources: [
      {
        file: 'cargo.json',
        md5: 'deadbeef',
        bytes: 3,
        range: { from: '2021-01', to: '2026-09', count: 66 },
      },
    ],
    artifacts: [{ file: 'throughput_model.json', md5: 'cafebabe', bytes: 2 }],
    fieldRows: buildFieldMap(FIXTURE, 'x.json'),
    generatedAt: '2026-10-03T00:00:00.000Z',
    determinism: '✅ 逐字节一致',
  })

  it('含输入指纹、产物指纹、映射表与确定性结论', () => {
    expect(report).toContain('cargo.json')
    expect(report).toContain('deadbeef')
    expect(report).toContain('2021-01 ~ 2026-09')
    expect(report).toContain('throughput_model.json')
    expect(report).toContain('cafebabe')
    expect(report).toContain('论文数字 → 产物字段')
    expect(report).toContain('✅ 逐字节一致')
  })

  it('不确定时不得出现"逐字节一致"的宣称', () => {
    const r2 = renderReport({
      sources: [],
      artifacts: [],
      fieldRows: [],
      generatedAt: 'x',
      determinism: '⚠️ 产物发生变化：activity.json',
    })
    expect(r2).not.toContain('逐字节一致')
    expect(r2).toContain('⚠️ 产物发生变化')
  })
})
