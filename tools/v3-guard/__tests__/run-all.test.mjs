import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  EXECUTOR_NAME,
  GUARDS,
  SEPARATELY_RUN,
  ciTriggerProblems,
  executionPlan,
  hookFiringProblems,
  runAll,
} from '../run-all.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GUARD_DIR = path.resolve(HERE, '..')
const ROOT = path.resolve(GUARD_DIR, '../..')

/** CI 里跑 `npm run <script>` 的 job：按「两空格缩进的 job 键」切块（不引 YAML 依赖） */
export function jobBlockOf(text, script) {
  const lines = text.split(/\r?\n/)
  const idx = lines.findIndex(
    (l) => !l.trim().startsWith('#') && /^\s+run:\s/.test(l) && l.includes(`npm run ${script}`)
  )
  if (idx < 0) return null
  let start = -1
  for (let i = idx; i >= 0; i--)
    if (/^ {2}[\w-]+:\s*$/.test(lines[i])) {
      start = i
      break
    }
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++)
    if (/^ {2}[\w-]+:\s*$/.test(lines[i])) {
      end = i
      break
    }
  return { id: lines[start].trim().replace(/:$/, ''), block: lines.slice(start, end).join('\n') }
}

describe('guard:v3 串联执行器（审查 z163）', () => {
  it('全部通过时 ok=true，且逐项记录退出码 0', () => {
    const calls = []
    const { results, ok } = runAll((name) => {
      calls.push(name)
      return { code: 0, signal: null }
    })
    expect(ok).toBe(true)
    expect(results).toHaveLength(GUARDS.length)
    expect(calls).toEqual(GUARDS)
  })

  it('@guard-red-sample 中间某项失败时不短路：其后的守卫仍然执行（这是替换 && 链的全部意义）', () => {
    const calls = []
    const failAt = GUARDS[2]
    const { results, ok } = runAll((name) => {
      calls.push(name)
      return { code: name === failAt ? 1 : 0, signal: null }
    })
    // 关键断言：失败项之后的守卫也被调用过
    expect(calls).toEqual(GUARDS)
    expect(calls.indexOf(GUARDS.at(-1))).toBe(GUARDS.length - 1)
    expect(ok).toBe(false)
    expect(results.filter((r) => r.code !== 0).map((r) => r.name)).toEqual([failAt])
  })

  it('被信号终止（code=null + signal）同样判为整体失败', () => {
    const { ok, results } = runAll((name) => ({
      code: name === GUARDS[0] ? null : 0,
      signal: name === GUARDS[0] ? 'SIGKILL' : null,
    }))
    expect(ok).toBe(false)
    expect(results[0]).toEqual({ name: GUARDS[0], code: null, signal: 'SIGKILL' })
  })

  it('清单非空、脚本文件都存在、且目录下没有未登记的守卫（防新守卫被静默遗漏）', () => {
    expect(GUARDS.length).toBeGreaterThan(0)
    const registered = [...GUARDS, ...SEPARATELY_RUN.map((g) => g.name)]
    for (const name of registered) {
      expect(fs.existsSync(path.join(GUARD_DIR, `${name}.mjs`)), `${name}.mjs 不存在`).toBe(true)
    }
    const onDisk = fs
      .readdirSync(GUARD_DIR)
      .filter((f) => f.endsWith('.mjs') && f !== 'run-all.mjs')
      .map((f) => f.replace(/\.mjs$/, ''))
    expect(
      onDisk.filter((n) => !registered.includes(n)),
      '新守卫必须在 run-all.mjs 的 GUARDS（快集）或 SEPARATELY_RUN（另跑）中登记，否则不会被执行'
    ).toEqual([])
  })

  it('@guard-red-sample SEPARATELY_RUN 项必须挂在**自动强制点**上：enforcedBy 里要有真命令行', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(GUARD_DIR, '../../package.json'), 'utf8'))
    for (const g of SEPARATELY_RUN) {
      const cmd = pkg.scripts?.[g.script]
      expect(
        cmd,
        `SEPARATELY_RUN 登记的 script「${g.script}」在 package.json 中不存在`
      ).toBeTruthy()
      expect(cmd, `script「${g.script}」未指向 ${g.name}`).toContain(`${g.name}.mjs`)
      expect(
        g.enforcedBy?.length,
        `${g.name} 没登记 enforcedBy —— 强制点必须是具体文件`
      ).toBeGreaterThan(0)
      for (const rel of g.enforcedBy) {
        const abs = path.join(GUARD_DIR, '../..', rel)
        expect(fs.existsSync(abs), `登记的强制点文件不存在：${rel}`).toBe(true)
        const lines = fs
          .readFileSync(abs, 'utf8')
          .split(/\r?\n/)
          .map((l) => l.trim())
        // 只认**命令行**：注释行与被注释掉的命令行都不算（把这两行 `#` 掉，本用例必须红）
        const invoked = lines.filter(
          (l) => !l.startsWith('#') && !/^echo\b/.test(l) && l.includes(`npm run ${g.script}`)
        )
        expect(
          invoked.length,
          `${rel} 里没有「npm run ${g.script}」的命令行 —— 登记了却没人跑，等于该守卫从未被自动复验`
        ).toBeGreaterThan(0)
      }
    }
  })

  it('执行计划覆盖登记的全部守卫（快集 + SEPARATELY_RUN），且无重名', () => {
    const plan = executionPlan()
    expect(new Set(plan).size, '执行计划里有重名守卫').toBe(plan.length)
    expect(plan).toEqual([...GUARDS, ...SEPARATELY_RUN.map((g) => g.name)])
    for (const g of SEPARATELY_RUN) {
      expect(plan, `${g.name} 不在执行计划里 —— 只登记不计划 = 静默遗漏`).toContain(g.name)
    }
    // 执行装置不是一条判据，不进计划（它的测试由 guard-red-mutation 复验）
    expect(plan).not.toContain(EXECUTOR_NAME)
  })

  it('SEPARATELY_RUN 项必须写明不进快集的理由（防「顺手塞进来」）', () => {
    for (const g of SEPARATELY_RUN) {
      expect(g.why, `${g.name} 缺少 why`).toBeTruthy()
      expect(g.why.length).toBeGreaterThan(8)
    }
  })

  it('@guard-red-sample 强制点必须真会触发：hooksPath→shim 在位，workflow on: 有效且 job 无 if:', () => {
    // 真仓：core.hooksPath → husky shim；shim 不在 = .husky/<hook> 永远不会被执行（z063 实测漏洞）
    let hooksPath = null
    try {
      hooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
        cwd: ROOT,
        encoding: 'utf8',
      }).trim()
    } catch {
      hooksPath = null
    }
    const hooks = [
      ...new Set(
        SEPARATELY_RUN.flatMap((g) => g.enforcedBy)
          .filter((rel) => rel.startsWith('.husky/'))
          .map((rel) => path.basename(rel))
      ),
    ]
    expect(
      hookFiringProblems(hooksPath, hooks, (rel) => fs.existsSync(path.join(ROOT, rel)))
    ).toEqual([])
    // workflow：on: 真的在；跑 guard:mutation 的 job 不许带条件
    const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')
    expect(ciTriggerProblems(wf, 'guard:mutation', jobBlockOf)).toEqual([])
  })

  it('@guard-red-sample 强制点自证的两种违约：缺 shim / job 带 if: 都必须报', () => {
    // 式 1（停用/置空）：hooksPath 下没有 shim ⇒ 必须报（把 fileExists 换成恒 false = 变异）
    expect(hookFiringProblems('.husky/_', ['pre-push'], () => false)).toHaveLength(1)
    expect(hookFiringProblems('.husky/_', ['pre-push'], () => true)).toEqual([])
    // 式 2（同义改写违约）：把 job 内容换成带 if: 的形态 ⇒ 必须报
    const wf = [
      'on:',
      '  push:',
      'jobs:',
      '  static-checks:',
      '    if: github.event_name == "push"',
      '    steps:',
      '      - name: 红样复验',
      '        run: npm run guard:mutation',
      '',
    ].join('\n')
    const problems = ciTriggerProblems(wf, 'guard:mutation', jobBlockOf)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('带 if: 条件')
  })
})
