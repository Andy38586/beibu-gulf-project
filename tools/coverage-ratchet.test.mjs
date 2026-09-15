/**
 * 覆盖率棘轮脚本测试：基线 schema 校验 + 检查/回退判定。
 * 脚本顶层读 argv 且有退出副作用，故以子进程真实执行，断言退出码与输出。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../scripts/coverage-ratchet.cjs', import.meta.url))

/** 子进程执行棘轮脚本；非零退出时归并 stdout/stderr 供断言 */
function run(args) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' })
    return { code: 0, output: stdout }
  } catch (err) {
    return { code: err.status ?? -1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

function writeFixture(dir, summary, baseline) {
  const summaryPath = join(dir, 'coverage-summary.json')
  const baselinePath = join(dir, 'coverage-baseline.json')
  writeFileSync(summaryPath, JSON.stringify(summary))
  writeFileSync(baselinePath, JSON.stringify(baseline))
  return [summaryPath, baselinePath]
}

const SUMMARY = {
  total: {
    lines: { pct: 50 },
    functions: { pct: 50 },
    branches: { pct: 50 },
    statements: { pct: 50 },
  },
}

describe('coverage-ratchet（基线 schema 校验）', () => {
  it('基线缺指标键 → 显式报错退出（旧实现 NaN 比较静默放行）', () => {
    const r = run(writeFixture(mkdtempSync(join(tmpdir(), 'ratchet-')), SUMMARY, { lines: 50 }))
    expect(r.code).toBe(1)
    expect(r.output).toContain('基线文件损坏')
    expect(r.output).toContain('functions/branches/statements')
  })

  it('基线含 NaN/非数值 → 同样拒绝', () => {
    const r = run(
      writeFixture(mkdtempSync(join(tmpdir(), 'ratchet-')), SUMMARY, {
        lines: 50,
        functions: '94.5',
        branches: NaN,
        statements: 50,
      })
    )
    expect(r.code).toBe(1)
    expect(r.output).toContain('基线文件损坏')
  })

  it('健康基线且无回退 → exit 0', () => {
    const r = run(
      writeFixture(mkdtempSync(join(tmpdir(), 'ratchet-')), SUMMARY, {
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50,
      })
    )
    expect(r.code).toBe(0)
    expect(r.output).toContain('[ratchet] 通过')
  })

  it('回退超容差 → exit 1（既有语义回归）', () => {
    const r = run(
      writeFixture(mkdtempSync(join(tmpdir(), 'ratchet-')), SUMMARY, {
        lines: 51,
        functions: 51,
        branches: 51,
        statements: 51,
      })
    )
    expect(r.code).toBe(1)
    expect(r.output).toContain('覆盖率相对基线回退超容差')
  })
})

// 「注入即红」：基线异常不得被当作「首跑」而放行（P1-06 / EP-09 壳化修复的可执行证据）
describe('coverage-ratchet（注入：基线异常不得静默放行）', () => {
  function summaryOnly(dir) {
    const summaryPath = join(dir, 'coverage-summary.json')
    writeFileSync(summaryPath, JSON.stringify(SUMMARY))
    return summaryPath
  }

  it('基线文件不存在且未带 --update → exit 1（CI 检查模式禁止重建基线）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ratchet-'))
    const r = run([summaryOnly(dir), join(dir, 'coverage-baseline.json')])
    expect(r.code).toBe(1)
    expect(r.output).toContain('CI 检查模式禁止重建基线')
  })

  it('基线 JSON 损坏（截断）→ exit 1，不得当作首跑重建', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ratchet-'))
    const baselinePath = join(dir, 'coverage-baseline.json')
    writeFileSync(baselinePath, '{"lines": 50, ') // 非法 JSON
    const r = run([summaryOnly(dir), baselinePath])
    expect(r.code).toBe(1)
    expect(r.output).toContain('JSON 解析失败')
  })

  it('基线不存在 + --update → exit 0 且建档（唯一被允许的建档路径）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ratchet-'))
    const baselinePath = join(dir, 'coverage-baseline.json')
    const r = run([summaryOnly(dir), baselinePath, '--update'])
    expect(r.code).toBe(0)
    expect(r.output).toContain('已按本次实测建档')
    expect(JSON.parse(readFileSync(baselinePath, 'utf8')).lines).toBe(50)
  })
})
