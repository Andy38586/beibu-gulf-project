import { describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'

import { deriveStatus, loadEvidence, parseAppendix, unregisteredGuards } from '../derive-status.mjs'
import { countBySpec } from '../../audit-kit/metrics-index.mjs'
import { executionPlan } from '../../v3-guard/run-all.mjs'

describe('指标账派生器', () => {
  it('kind → 状态字母：guard=A / test=B / retired=退役 / 无映射或未知=C', () => {
    expect(deriveStatus({ kind: 'guard' })).toBe('A')
    expect(deriveStatus({ kind: 'test' })).toBe('B')
    expect(deriveStatus({ kind: 'retired' })).toBe('退役')
    expect(deriveStatus(undefined)).toBe('C')
    expect(deriveStatus({ kind: 'mystery' })).toBe('C')
  })

  it('真实附录：条数与专项正文一致、编号全限定不跨专项撞号', () => {
    const text = readFileSync(
      new URL(
        '../../../docs/根基文档/审查体系专项/附录-指标固化状态与迁移路线图.md',
        import.meta.url
      ),
      'utf8'
    )
    const { sections } = parseAppendix(text)
    const all = sections.flatMap((s) => s.rows)
    const 正文 = Object.values(countBySpec()).reduce((a, b) => a + b, 0)
    expect(all.length).toBe(正文)
    const ids = new Set(all.map((r) => r.id))
    expect(ids.size).toBe(正文) // 专项N:x.y 全限定 ⇒ 无撞号
    expect(all.every((r) => r.id.includes(':'))).toBe(true)
  })

  it('真实证据映射：通过活性校验（ref 存在 + guard 已被 run-all 登记）', () => {
    const map = loadEvidence()
    expect(Object.keys(map).length).toBeGreaterThan(0)
    for (const ev of Object.values(map)) {
      expect(['guard', 'test', 'retired']).toContain(ev.kind)
      expect(ev.by).toBeTruthy() // 登记必须带依据
    }
  })

  it('🔴 反向校验（W74）：执行计划里的每个守卫都必须登记固化的指标编号', () => {
    // 治的失效：修前只有「登记了但守卫没了」正向一条路径，「守卫在跑却没登记固化哪条指标」
    // 无代码路径 ⇒ 29 个执行体只登记 2 条、401/403 条停在 C 级占位，metrics:derive 仍 exit 0。
    // 判据收在 loadEvidence() 里（不是散在 main()）：否则删掉 main 的那段仍全绿（变异 M1 实测）。
    expect(() => loadEvidence()).not.toThrow()
    expect(unregisteredGuards(executionPlan(), loadEvidence())).toEqual([])
    // 分母自洽：判据集非空（空集合下 filter/every 恒真 ⇒ 假绿壳）
    expect(executionPlan().length).toBeGreaterThan(0)
  })

  it('🔴 反向校验能红：合成映射漏掉任一执行体即抛，且点名', () => {
    // 阳性对照：把真实映射的最后一整条删掉，必须抛错并点出那个守卫。
    const real = JSON.parse(readFileSync(new URL('../evidence.json', import.meta.url), 'utf8'))
    const ids = Object.keys(real).filter((k) => k.startsWith('专项'))
    // 只留一半登记 ⇒ 必然有一批执行体没有归属
    const half = {}
    for (const id of ids.slice(0, Math.floor(ids.length / 2))) half[id] = real[id]
    expect(() => loadEvidence(half)).toThrow(/没有登记固化的指标编号/)
    // 阴性对照：全量映射不许抛
    expect(() => loadEvidence(real)).not.toThrow()
  })

  it('🔴 正向校验能红：ref 文件存在但不在执行计划 ⇒ 抛「未被 run-all 登记」', () => {
    // 治的失效：守卫被删/改名后，证据映射仍声称「这条指标由它固化」⇒ 派生出的 A 是假 A。
    // 合成映射用真实存在但非守卫的文件（appendix-rows.mjs 是库，不是执行体），
    // 这样判据不依赖「文件不存在」那条更早的分支。
    const synth = {
      '专项1:1.1': {
        kind: 'guard',
        refs: ['tools/v3-guard/lib/appendix-rows.mjs'],
        by: '合成夹具',
      },
    }
    expect(() => loadEvidence(synth)).toThrow(/未被 run-all 登记/)
    // 阴性对照：同样一条换成真实执行体就不许抛（否则判据等于「凡合成必红」）
    const ok = {
      '专项1:1.1': {
        kind: 'guard',
        refs: [`tools/v3-guard/${executionPlan()[0]}.mjs`],
        by: '合成夹具',
      },
    }
    expect(() => loadEvidence(ok)).toThrow(/没有登记固化的指标编号/) // 只因反向校验缺其余守卫
  })

  it('🔴 判定按 basename 去后缀比对（防止判据只认整条路径字面量）', () => {
    // 纯函数直测：refs 里放不同目录深度，只要 basename 是执行体名就算已登记
    const guard = executionPlan()[0]
    const map = {
      '专项1:1.1': { kind: 'guard', refs: [`tools/v3-guard/${guard}.mjs`], by: '合成夹具' },
    }
    expect(unregisteredGuards([guard], map)).toEqual([])
    expect(unregisteredGuards(['not-this-one'], map)).toEqual(['not-this-one'])
  })

  it('🔴 强制点接线（1004-09）：pre-push 与 CI 各有可执行的 metrics:derive 步骤', () => {
    // 自查「手改即红」的判据必须有自动触发面；只挂 ci:local（人手敲）等于没有强制点。
    for (const rel of ['.husky/pre-push', '.github/workflows/ci.yml']) {
      const invoked = readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8')
        .split(/\r?\n/)
        .filter((l) => !l.trim().startsWith('#')) // 注释行不算触发
        .some((l) => l.includes('npm run metrics:derive'))
      expect(invoked, `${rel} 缺 npm run metrics:derive 可执行步骤`).toBe(true)
    }
  })

  it('🔴 A-/D 有登记通道且解析器同源（专3-F-01：只认 4 值即红）', () => {
    // 附录值域 6 值（lib STATES）必须都能派生：A- 待激活 / D 常驻此前无 kind
    expect(deriveStatus({ kind: 'pending-activation' })).toBe('A-')
    expect(deriveStatus({ kind: 'resident' })).toBe('D')
    expect(deriveStatus({ kind: 'guard' })).toBe('A')
    expect(deriveStatus({ kind: 'test' })).toBe('B')
    expect(deriveStatus({ kind: 'retired' })).toBe('退役')

    // 解析器文本可注入：A- 与 D 数据行必须被 parseAppendix 收到（旧正则静默丢）
    const md = [
      '### 专项1',
      '| 1.1 | 名称甲 | P2 | A- | 证据 |',
      '| 1.2 | 名称乙 | P3 | D | 证据 |',
      '| 1.3 | 名称丙 | P1 | C | 证据 |',
    ].join('\n')
    const { sections, unparsed } = parseAppendix(md)
    expect(sections[0].rows.map((r) => r.status)).toEqual(['A-', 'D', 'C'])
    expect(unparsed).toHaveLength(0)
  })

  it('🔴 值域外状态与结构漂移分开报（专3-F-01：误指「表格结构漂移」即红）', () => {
    const md = ['### 专项1', '| 1.1 | 名称甲 | P2 | Z | 证据 |'].join('\n')
    const { sections, unparsed } = parseAppendix(md)
    expect(sections[0].rows).toHaveLength(0)
    expect(unparsed).toHaveLength(1)
    expect(unparsed[0].state).toBe('Z')
  })
})
