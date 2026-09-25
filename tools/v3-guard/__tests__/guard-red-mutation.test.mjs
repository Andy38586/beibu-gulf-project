// @vitest-environment node
/**
 * guard-red-mutation 的自测（含红样）。
 *
 * 本守卫的判据是「停用一个守卫的审计函数 ⇒ 它的测试必须变红」。自测钉四件事：
 *   1) 注入器只在函数体开头插 `return []`，找不到锚点必须返回 null（不许插错位置）；
 *   2) `survived` / `error` ⇒ 必报（这正是本守卫存在的理由）；
 *   3) `killed` / `skip` ⇒ 不报；基线豁免只对被登记的守卫生效；
 *   4) **端到端**：对真实守卫 `tmp-hygiene` 跑一次完整探测，断言它 killed ——
 *      证明装置真的会跑子进程、真的能区分「红」与「跑不起来」。
 */
import { describe, expect, it } from 'vitest'

import {
  auditResults,
  importedNames,
  injectEarlyReturn,
  pickInjectables,
  probeGuard,
} from '../guard-red-mutation.mjs'

describe('guard-red-mutation — 守卫红样能红性复验', () => {
  it('importedNames 只取守卫自身 import 的具名导出', () => {
    const src = "import { audit, scan } from '../foo.mjs'\nimport { x } from 'y'\n"
    expect(importedNames(src)).toEqual(['audit', 'scan'])
  })

  it('pickInjectables 只认「export function」形态（常量导出不可注入）', () => {
    const src = 'export function audit() {}\nexport const KEYS = []\n'
    expect(pickInjectables(src, ['audit', 'KEYS'])).toEqual(['audit'])
  })

  it('injectEarlyReturn 在函数体开头插 return []，锚点缺失返回 null', () => {
    const out = injectEarlyReturn('export function f(a) {\n  return a\n}\n', 'f')
    expect(out).toContain('export function f(a) {\n  return []\n')
    expect(injectEarlyReturn('const x = 1\n', 'f')).toBeNull()
  })

  it('@guard-red-sample survived ⇒ 必报（假绿样是本守卫要抓的东西）', () => {
    const problems = auditResults([{ guard: 'x', status: 'survived', detail: '仍绿' }])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('x: survived')
  })

  it('@guard-red-sample error ⇒ 必报（跑不起来不许当成通过）', () => {
    expect(auditResults([{ guard: 'y', status: 'error', detail: 'status=null' }])).toHaveLength(1)
  })

  it('killed / skip ⇒ 不报', () => {
    expect(
      auditResults([
        { guard: 'a', status: 'killed' },
        { guard: 'b', status: 'skip', detail: '无测试文件' },
      ])
    ).toEqual([])
  })

  it('基线豁免只对被登记的那一项生效，其余同状态仍报', () => {
    const rs = [
      { guard: 'a', status: 'survived' },
      { guard: 'b', status: 'survived' },
    ]
    expect(auditResults(rs, { baseline: ['a'] })).toHaveLength(1)
    expect(auditResults(rs, { baseline: ['a'] })[0]).toContain('b: survived')
  })

  it('端到端：对真实守卫 tmp-hygiene 做一次探测 ⇒ killed（装置真的会跑并识别红）', () => {
    const r = probeGuard('tmp-hygiene')
    expect(r.status).toBe('killed')
    expect(r.detail).toContain('exit')
  }, 120000)
})
