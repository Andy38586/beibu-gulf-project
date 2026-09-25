// @vitest-environment node
/**
 * guard-red-mutation 的自测（含红样）。
 *
 * 本守卫的判据是「停用一个守卫的审计函数 ⇒ 它的测试必须变红」。自测钉六件事：
 *   1) 注入器只在函数体开头插 `return []`，找不到锚点必须返回 null（不许插错位置）；
 *   2) `survived` / `error` ⇒ 必报（这正是本守卫存在的理由）；
 *   3) `skip` ⇒ **必报**（曾经是合法放行：摘掉某守卫的 test 文件 = 它整体退出复验且
 *      装置照报 OK —— 装置自己犯它要治的病，2026-09-25 收口）；豁免必须显式登记；
 *   4) 端到端：造一个「无 test 文件」的守卫 ⇒ 判 skip 且判成问题；
 *   5) 复验清单从 run-all 的登记派生（含执行装置、不含自身、无幽灵登记）；
 *   6) **端到端**：对真实守卫 `tmp-hygiene` 跑一次完整探测，断言它 killed ——
 *      证明装置真的会跑子进程、真的能区分「红」与「跑不起来」。
 */
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  auditResults,
  guardsToProbe,
  importedNames,
  injectEarlyReturn,
  pickInjectables,
  probeGuard,
} from '../guard-red-mutation.mjs'
import { EXECUTOR_NAME, executionPlan } from '../run-all.mjs'

const GUARD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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

  it('killed ⇒ 不报', () => {
    expect(auditResults([{ guard: 'a', status: 'killed', detail: '停用 audit ⇒ 红' }])).toEqual([])
  })

  it('@guard-red-sample skip ⇒ 必报（"没有 test 文件"曾经是合法放行）', () => {
    const problems = auditResults([{ guard: 'b', status: 'skip', detail: '无测试文件' }])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('b: skip')
    expect(problems[0], '文案要写清后果：没有 test = 整体退出复验').toContain('退出红样复验')
    // 显式登记才可豁免，且不吞掉别的项
    expect(auditResults([{ guard: 'b', status: 'skip' }], { baseline: ['b'] })).toEqual([])
    expect(
      auditResults(
        [
          { guard: 'b', status: 'skip' },
          { guard: 'c', status: 'skip' },
        ],
        { baseline: ['b'] }
      )
    ).toHaveLength(1)
  })

  it('@guard-red-sample 端到端：喂一个「无 test 文件」的守卫名 ⇒ 装置判 skip，且判成问题', () => {
    const guardDir = mkdtempSync(join(tmpdir(), 'grm-g-'))
    const root = mkdtempSync(join(tmpdir(), 'grm-root-'))
    writeFileSync(join(guardDir, 'gx.mjs'), 'export function audit() { return [] }\n')
    const r = probeGuard('gx', { guardDir, root })
    expect(r.status).toBe('skip')
    expect(auditResults([r])).toHaveLength(1)
  })

  it('复验清单从 run-all 的登记派生：含执行装置、不含自身、不混入未登记文件', () => {
    const guards = guardsToProbe()
    const plan = executionPlan()
    for (const n of plan) if (n !== 'guard-red-mutation') expect(guards).toContain(n)
    expect(guards, '执行装置的测试也要被复验').toContain(EXECUTOR_NAME)
    expect(guards, '装置不能注入自己').not.toContain('guard-red-mutation')
    const onDisk = readdirSync(GUARD_DIR)
      .filter((f) => f.endsWith('.mjs'))
      .map((f) => f.replace(/\.mjs$/, ''))
    expect(
      guards.filter((n) => !onDisk.includes(n)),
      '清单里出现了目录中不存在的名字（幽灵登记）'
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
