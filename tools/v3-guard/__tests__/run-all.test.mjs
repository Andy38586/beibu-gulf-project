import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { EXECUTOR_NAME, GUARDS, SEPARATELY_RUN, executionPlan, runAll } from '../run-all.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GUARD_DIR = path.resolve(HERE, '..')

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
})
