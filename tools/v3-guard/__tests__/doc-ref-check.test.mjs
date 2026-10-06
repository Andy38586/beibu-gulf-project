/**
 * doc-ref-check 自测：真红样（引用解析不了必红）+ 阳性对照（好引用不许误红）。
 * 注入式：目标集与指标集都是参数，红样不必改真文档。
 */
import { describe, expect, it } from 'vitest'

import { auditRefs, headingNumbers, loadPlan } from '../doc-ref-check.mjs'

const TARGETS = new Map([
  ['K1', { path: 'docs/契约/K1.md', text: '## A. 渲染与地图\n### A1 x\n## B. 数据与契约\n' }],
  ['K2', { path: 'docs/契约/K2.md', text: '## 一、数据流总览\n### 5.1 Renderer 生命周期\n' }],
  ['C1', { path: 'docs/宪法/C1.md', text: '## §6 范围口径\n' }],
])
const METRICS = new Map([
  ['专项7', new Set(['3.2'])],
  ['专项8', new Set(['3.4', '3.5'])],
])
const run = (text) => auditRefs([{ path: 'AGENTS.md', text }], TARGETS, METRICS)

describe('doc-ref-check — 节号解析', () => {
  it('标题三种记法都能被 §N 指到（§N / N. / 中文序号 / 字母节）', () => {
    const nums = headingNumbers(TARGETS.get('K2').text)
    expect(nums.has('1')).toBe(true)
    expect(nums.has('5.1')).toBe(true)
    expect(headingNumbers(TARGETS.get('K1').text).has('B')).toBe(true)
    expect(headingNumbers(TARGETS.get('C1').text).has('6')).toBe(true)
  })

  it('@guard-red-sample 三类引用任一解析不了 ⇒ 必红（K1 §Z / K2 §9 / 专项7 指标 9.9）', () => {
    const problems = run('见 K1 §Z、K2 §9、专项7 指标 9.9\n')
    expect(problems).toHaveLength(3)
    expect(problems[0]).toContain('K1 §Z 解析不了')
    expect(problems[1]).toContain('K2 §9 解析不了')
    expect(problems[2]).toContain('专项7 9.9 解析不了')
  })

  it('阳性对照：同一形态的好引用（含多引用链）不许红', () => {
    expect(
      run('见 K1 §B、K1 §A/§B、K2 §1、K2 §5.1、C1 §6、专项7 指标 3.2、专项8 3.4/3.5\n')
    ).toEqual([])
  })

  it('等价重构不误红：换了标点/空格的同一条引用照样解析', () => {
    expect(run('见 K1§B 与 K2 § 5.1 与 专项8 3.4 / 3.5')).toEqual([])
  })

  it('指到真文档真节号的端到端：10 份受控文档全绿（真仓索引）', () => {
    const plan = loadPlan()
    expect(plan.files.length).toBeGreaterThanOrEqual(8)
    expect(auditRefs(plan.files, plan.targets, plan.metricIds)).toEqual([])
  })
})
