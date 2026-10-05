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
})
