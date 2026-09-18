/**
 * 覆盖率棘轮脚本测试：基线 schema 校验 + 检查/回退判定。
 * 脚本顶层读 argv 且有退出副作用，故以子进程真实执行，断言退出码与输出。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../scripts/coverage-ratchet.cjs', import.meta.url))

/**
 * 子进程执行棘轮脚本；**归并 stdout+stderr**。
 * ⚠️ 必须两条流都收：降级提示走 console.warn（stderr），若只在非零退出时归并，
 * exit 0 场景的断言（如「降级 WARN」）会拿到空串而误报失败（2026-09-18 实测踩过）。
 */
function run(args) {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' })
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` }
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

// ── 基线冻结校验（--freeze-check，2026-09-18 审计 D-03）────────────────────
// 动机：棘轮「只升不降」⇒ 基线被抬高即永久钝化。原护栏只有「CI 不带 --update」，
// 拦不住「本地 ci:local --update 抬高基线 → 连同提交」。本组锁住冻结校验的行为，
// 重点是**区分「git 不可用」与「基线漂移」**——前者降级放行、后者必须报红，
// 两者混淆会让检查在 CI 里静默失效（这正是本次审计要根除的模式）。
describe('coverage-ratchet --freeze-check（基线冻结校验）', () => {
  /** 在临时 git 仓库里放一个 baseline，提交后再可选改动它 */
  function gitRepoFixture({ commit = true, mutate = null } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'freeze-'))
    const rel = 'coverage-baseline.json'
    const abs = join(dir, rel)
    const git = (args) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    writeFileSync(abs, JSON.stringify({ lines: 50, functions: 50, branches: 50, statements: 50 }))
    git(['init', '-q'])
    git(['config', 'user.email', 't@t.t'])
    git(['config', 'user.name', 't'])
    if (commit) {
      git(['add', rel])
      git(['commit', '-q', '-m', 'chore: fixture'])
    }
    if (mutate) writeFileSync(abs, JSON.stringify({ ...mutate }))
    return { dir, abs, rel }
  }

  it('基线与 HEAD 一致 → exit 0（MATCH）', () => {
    const { abs } = gitRepoFixture()
    const r = run(['--freeze-check', abs])
    expect(r.code).toBe(0)
    expect(r.output).toContain('基线冻结校验通过')
  })

  // 核心断言：本地把基线抬高（未提交）必须报红，并逐指标列出差异。
  // 若这条退化成 exit 0，整个棘轮强度就回落成「谁都能悄悄抬基线」。
  it('基线被本地改写（未提交）→ exit 1 且列出逐指标差异（DRIFT）', () => {
    const { abs } = gitRepoFixture({
      mutate: { lines: 99, functions: 50, branches: 50, statements: 50 },
    })
    const r = run(['--freeze-check', abs])
    expect(r.code).toBe(1)
    expect(r.output).toContain('工作区基线已被本地改写')
    expect(r.output).toContain('lines: HEAD 50% → 工作区 99%')
    expect(r.output).toContain('只升不降')
  })

  // 非 git 目录（tarball 分发/临时目录）必须降级为 WARN 放行，而不是误红。
  // 这条与上一条成对：一个防「该红不红」，一个防「不该红却红」。
  it('非 git 目录 → 降级 WARN 且 exit 0（不误红）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nogit-'))
    const abs = join(dir, 'coverage-baseline.json')
    writeFileSync(abs, JSON.stringify({ lines: 50, functions: 50, branches: 50, statements: 50 }))
    const r = run(['--freeze-check', abs])
    expect(r.code).toBe(0)
    expect(r.output).toContain('基线冻结校验降级')
  })

  it('基线未被 HEAD 跟踪（新增文件尚未提交）→ exit 1（DRIFT）', () => {
    // 这条很容易被误判成「git 不可用」而降级放行——必须报红：
    // 「基线未提交」等价于「棘轮无锚点」，放过它等于允许用未审阅的基线替换现有基线。
    // ⚠️ fixture 里 commit:false ⇒ 仓库**一个提交都没有**，命中 NO_HEAD 分支。
    //   这仍是 DRIFT（fail-closed），不是 GIT_UNAVAILABLE —— 否则「git init 空仓」
    //   就成了绕过冻结校验的路径。断言只锁语义（报红 + 说明无锚点），不锁内部代号。
    const { dir, abs } = gitRepoFixture({ commit: false })
    expect(abs).toBe(join(dir, 'coverage-baseline.json'))
    const r = run(['--freeze-check', abs])
    expect(r.code).toBe(1)
    expect(r.output).toContain('工作区基线已被本地改写')
    expect(r.output).toMatch(/未被 HEAD 跟踪|无冻结锚点|尚无任何提交/)
  })

  // 补一条：仓库**有提交**但基线是新增未提交文件（真实的「忘了 git add」场景）。
  // 与上一条区别在于 HEAD 可解析，走 ls-tree 判据而非 rev-parse。
  it('仓库有提交但基线未纳入（漏 git add）→ exit 1（DRIFT）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'freeze-untracked-'))
    const git = (args) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    git(['init', '-q'])
    git(['config', 'user.email', 't@t.t'])
    git(['config', 'user.name', 't'])
    writeFileSync(join(dir, 'README.md'), 'x\n')
    git(['add', 'README.md'])
    git(['commit', '-q', '-m', 'chore: fixture'])
    const abs = join(dir, 'coverage-baseline.json')
    writeFileSync(abs, JSON.stringify({ lines: 50, functions: 50, branches: 50, statements: 50 }))
    const r = run(['--freeze-check', abs])
    expect(r.code).toBe(1)
    expect(r.output).toContain('未被 HEAD 跟踪')
  })

  it('缺参数 → exit 2 并给出用法', () => {
    const r = run(['--freeze-check'])
    expect(r.code).toBe(2)
    expect(r.output).toContain('用法')
  })

  // 传一个不存在的基线路径必须报红：历史缺陷是 ENOENT 落进「git 不可用」降级分支 ⇒
  // exit 0 假绿，等于「路径写错 = 检查自动关掉」。
  it('基线路径不存在 → exit 1（不得降级假绿）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'freeze-missing-'))
    const r = run(['--freeze-check', join(dir, 'nope.json')])
    expect(r.code).toBe(1)
    expect(r.output).toContain('基线文件不存在')
  })

  it('相对路径以 cwd 为基准解析（cd frontend 场景）', () => {
    // 回归锁：先前一律以脚本所在 repoRoot 为基准解析相对路径，
    // 导致 `cd frontend && node ../scripts/coverage-ratchet.cjs --freeze-check
    // coverage-baseline.json` 解析到 <repo>/coverage-baseline.json（不存在）→ 假绿。
    const r = spawnSync('node', [SCRIPT, '--freeze-check', 'coverage-baseline.json'], {
      cwd: fileURLToPath(new URL('../frontend/', import.meta.url)),
      encoding: 'utf8',
    })
    expect(r.status).toBe(0)
    expect(`${r.stdout}${r.stderr}`).toContain('基线冻结校验通过')
  })
})
