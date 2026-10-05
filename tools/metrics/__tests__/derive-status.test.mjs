import { describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'

import { deriveStatus, loadEvidence, parseAppendix } from '../derive-status.mjs'
import { countBySpec } from '../../audit-kit/metrics-index.mjs'

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
