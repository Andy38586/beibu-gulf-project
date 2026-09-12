import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { GUARDS, runAll } from '../run-all.mjs'

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

  it('中间某项失败时不短路：其后的守卫仍然执行（这是替换 && 链的全部意义）', () => {
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
    for (const name of GUARDS) {
      expect(fs.existsSync(path.join(GUARD_DIR, `${name}.mjs`)), `${name}.mjs 不存在`).toBe(true)
    }
    const onDisk = fs
      .readdirSync(GUARD_DIR)
      .filter((f) => f.endsWith('.mjs') && f !== 'run-all.mjs')
      .map((f) => f.replace(/\.mjs$/, ''))
    expect(
      onDisk.filter((n) => !GUARDS.includes(n)),
      '新守卫必须在 run-all.mjs 的 GUARDS 中登记，否则不会被执行'
    ).toEqual([])
  })
})
