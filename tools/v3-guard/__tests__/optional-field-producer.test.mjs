// @vitest-environment node
/**
 * optional-field-producer 自测（根因 B / W47 的机制判据）。
 *
 * 治的是「接口承诺了可传、全仓没人传」——`LayerOptions.cluster` 活了 68 天才被发现。
 *
 * 钉五件事：
 *   1) 零生产者字段 ⇒ 必红，且文案点名到「接口.字段」；
 *   2) 有生产点（对象字面量里赋值）⇒ 不红；
 *   3) 只有读取点（`options.x?.()` 这类，生产来自展开/默认值）⇒ 不红；
 *   4) 豁免清单里的字段 ⇒ 不红（豁免必须写明理由，测试里也验）；
 *   5) 解析到 0 个可选字段 ⇒ 红（空集不许报通过）。
 */
import { describe, expect, it } from 'vitest'

import {
  ALLOWED,
  auditOptionalProducers,
  candidateBlocks,
  MANAGED as REAL_MANAGED,
  optionalFieldsOf,
} from '../optional-field-producer.mjs'

const DECL = `export interface Demo {
  a?: string
  b?: number
  c?: boolean
}
`

const MANAGED = [{ file: 'demo.ts', name: 'Demo' }]

/** 便捷构造：把「文件路径 → 内容」喂进去 */
function audit(files, { allowed = [], managed = MANAGED, decl = DECL } = {}) {
  const map = new Map(Object.entries(files))
  return auditOptionalProducers({
    read: (f) => map.get(f) ?? '',
    sources: [...map.keys()],
    decls: new Map([['Demo', decl]]),
    managed,
    allowed,
  })
}

describe('optional-field-producer：可选字段必须有生产者', () => {
  it('@guard-red-sample 三个字段全零生产者 ⇒ 必红，且逐个点名', () => {
    const { problems } = audit({ 'a.ts': 'export const unrelated = 1\n' })
    expect(problems).toHaveLength(3)
    expect(problems.join('\n')).toContain('Demo.a')
    expect(problems.join('\n')).toContain('Demo.b')
    expect(problems.join('\n')).toContain('Demo.c')
  })

  it('对象字面量里赋值 ⇒ 不算零生产者', () => {
    const { problems, report } = audit({
      'a.ts': 'const o: Demo = { a: "x", b: 1 }\n',
    })
    expect(problems.map((p) => p.slice(0, 6))).toEqual(['Demo.c'])
    expect(report.Demo.a.L2).toBeGreaterThan(0)
  })

  it('@guard-red-sample 只有读取点也算有者（生产来自展开/默认值，静态看不见）', () => {
    const { problems } = audit({ 'a.ts': 'export const f = (options: Demo) => options.b ?? 0\n' })
    expect(problems).not.toContainEqual(expect.stringContaining('Demo.b'))
    expect(problems).toHaveLength(2) // 只剩 a 与 c
  })

  it('豁免清单里的字段 ⇒ 不红', () => {
    const { problems } = audit(
      { 'a.ts': '' },
      { allowed: [{ iface: 'Demo', field: 'a', why: '测试夹具' }] }
    )
    expect(problems.map((p) => p.slice(0, 6))).toEqual(['Demo.b', 'Demo.c'])
  })

  it('@guard-red-sample 解析到 0 个可选字段 ⇒ 红（空集不许报通过）', () => {
    const { problems } = audit({ 'a.ts': '' }, { decl: 'export interface Demo { a: string }\n' })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('解析到 0 个可选字段')
  })

  it('声明文件缺失 ⇒ 红（不改名不搬家却静默通过）', () => {
    const map = new Map([['a.ts', '']])
    const { problems } = auditOptionalProducers({
      read: (f) => map.get(f) ?? '',
      sources: [...map.keys()],
      decls: new Map(), // 没有 Demo 声明
      managed: MANAGED,
      allowed: [],
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('声明文件读不到')
  })
})

describe('optionalFieldsOf / candidateBlocks：判据域的形状', () => {
  it('只收可选字段（必填字段不在此判据面）', () => {
    expect(optionalFieldsOf('export interface D { x?: 1; y: 2 }\n', 'D')).toEqual(['x'])
  })

  it('四种起手式都算生产块（: X = / ): X { / options: / as X）', () => {
    const text = [
      'const p: Demo = { a: 1 }',
      'function f(): Demo { return { b: 2 } }',
      'reg({ options: { c: true } })',
      'x as Demo',
    ].join('\n')
    const blocks = candidateBlocks(text, 'Demo')
    expect(blocks.some((b) => /\ba\s*:/.test(b))).toBe(true)
    expect(blocks.some((b) => /\bb\s*:/.test(b))).toBe(true)
    expect(blocks.some((b) => /\bc\s*:/.test(b))).toBe(true)
  })

  it('扩接口棘轮：CameraState 必须在受管清单（2026-10-24 §四-10 扩容不得静默缩域）', () => {
    expect(
      REAL_MANAGED.some(
        (m) => m.name === 'CameraState' && m.file === 'frontend/src/types/renderer.ts'
      )
    ).toBe(true)
    // 同族对照：数据载体接口（GeoJSON Feature 形状）不得进受管清单——
    // 其字段由后端数据/GeoJSON 解析动态生产，L2/L3 字面量口径结构性不可见，纳入只会产出永久豁免
    expect(REAL_MANAGED.every((m) => !/(Point|Polygon)Feature/.test(m.name))).toBe(true)
  })

  it('真实豁免清单每条都写了理由（空理由 = 无豁免）', () => {
    for (const a of ALLOWED) {
      expect(a.why, `${a.iface}.${a.field} 缺理由`).toBeTruthy()
      expect(a.why.length).toBeGreaterThan(20)
    }
  })
})
