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
 *   7) 注入点必须落在**函数体**（跳过解构参数），且注入产物必须可解析 ——
 *      2026-10-09 假杀修复：旧实现把 `return []` 插进参数表 ⇒ parse error 被当成 killed。
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import {
  auditControls,
  auditResults,
  cleanupProbeWorktree,
  copyWorkingTreeChanges,
  createProbeWorktree,
  fileMd5,
  guardsToProbe,
  importedNames,
  injectEarlyReturn,
  parsesModule,
  pickInjectables,
  probeGuard,
  redSampleNeedsControl,
  removeProbeWorktree,
  stageInjection,
  sweepStaleWorktrees,
} from '../guard-red-mutation.mjs'
import { EXECUTOR_NAME, executionPlan } from '../run-all.mjs'

const GUARD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(GUARD_DIR, '../..')

// 会话级副本只在 main() 的 finally 里清理；测试里要自己收尾，否则留下 100MB+ 目录
afterAll(() => cleanupProbeWorktree())

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

  it('@guard-red-sample 解构参数的注入点落在函数体，旧形状（插进参数表）必须解析失败', () => {
    const src = 'export function scan({ root = ROOT, ext = [] } = {}) {\n  return root\n}\n'
    const out = injectEarlyReturn(src, 'scan')
    expect(out).not.toBeNull()
    expect(
      out.indexOf('return []'),
      '注入必须发生在参数表闭合之后（旧实现落进解构参数 = 假杀）'
    ).toBeGreaterThan(out.indexOf('} = {})'))
    expect(parsesModule(out), '注入产物必须仍是合法模块').toBe(true)
    // 阳性对照：旧实现的形状（紧跟第一个 `{` 注入）必须解析失败，否则本用例证明不了假杀
    const oldShape = src.replace('export function scan({', 'export function scan({\n  return []\n')
    expect(parsesModule(oldShape), '旧形状应当解析失败').toBe(false)
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

describe('F101 B：注入只写临时 worktree 副本（硬杀不留注入态）', () => {
  it('@guard-red-sample 副本注入：真件 md5 不变，正常清理后副本消失', () => {
    const realGuard = join(GUARD_DIR, 'tmp-hygiene.mjs')
    const before = fileMd5(realGuard)
    const wt = createProbeWorktree()
    try {
      const copy = stageInjection(wt, 'tmp-hygiene', 'scan')
      expect(copy, '找不到注入锚点').toBeTruthy()
      expect(copy, '注入路径必须在副本里').not.toBe(realGuard)
      expect(readFileSync(copy, 'utf8')).toContain('return []')
      expect(fileMd5(realGuard), '副本注入不得改真件').toBe(before)
      // shim 随副本复制由下一条用例用**临时仓库**自证（旧实现 if (existsSync(shim)) 才断言，
      // shim 缺失时该断言静默不执行 —— 等价于没有判据）
    } finally {
      removeProbeWorktree(wt.dir)
    }
    expect(existsSync(wt.dir), '正常清理后副本目录必须消失').toBe(false)
    expect(fileMd5(realGuard)).toBe(before)
  }, 120000)

  it('@guard-red-sample 未提交的 .husky/_/pre-push 随副本复制，且真实 .husky 不被改', () => {
    // 不依赖 husky install 产物：自建临时仓库，shim **只在盘、不进 HEAD**（正是生成物的形态）
    const realShim = join(ROOT, '.husky/_/pre-push')
    const realShimBefore = existsSync(realShim) ? fileMd5(realShim) : null

    const repo = mkdtempSync(join(tmpdir(), 'grm-shim-repo-'))
    const git = (args) => {
      const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`)
    }
    let wt = null
    try {
      git(['init', '-q'])
      writeFileSync(join(repo, 'README.md'), 'tmp repo\n')
      // 注入副本落在 <root>/.local/tmp 下，必须被 ignore，否则 git status 会把它自己列成未跟踪目录
      writeFileSync(join(repo, '.gitignore'), '.local/\n')
      mkdirSync(join(repo, 'tools', 'v3-guard'), { recursive: true })
      writeFileSync(
        join(repo, 'tools', 'v3-guard', 'tmp-hygiene.mjs'),
        'export function scan() {\n  return []\n}\n'
      )
      git(['add', '.'])
      git(['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'init'])
      mkdirSync(join(repo, '.husky', '_'), { recursive: true })
      writeFileSync(join(repo, '.husky', '_', 'pre-push'), '#!/bin/sh\necho tmp-shim\n')

      wt = createProbeWorktree({ root: repo })
      const copied = join(wt.dir, '.husky', '_', 'pre-push')
      expect(existsSync(copied), '未提交的 shim 必须随工作区复制进副本（旧实现静默跳过）').toBe(
        true
      )
      expect(readFileSync(copied, 'utf8')).toContain('tmp-shim')
      // 源仓库（=「真件」）不得被复制/注入改动
      expect(readFileSync(join(repo, '.husky', '_', 'pre-push'), 'utf8')).toContain('tmp-shim')
    } finally {
      if (wt) removeProbeWorktree(wt.dir, { root: repo })
      rmSync(repo, { recursive: true, force: true })
    }
    expect(wt && existsSync(wt.dir), '副本必须清理干净').toBe(false)
    if (realShimBefore !== null) {
      expect(fileMd5(realShim), '本用例不得改动真实 .husky/_/pre-push').toBe(realShimBefore)
    }
  }, 120000)

  it('工作区首个修改文件也必须复制进副本（-z 前导空格不得被 trim）', () => {
    const repo = mkdtempSync(join(tmpdir(), 'grm-copy-repo-'))
    const dest = mkdtempSync(join(tmpdir(), 'grm-copy-dest-'))
    const git = (args) => {
      const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`)
    }
    try {
      git(['init', '-q'])
      writeFileSync(join(repo, 'a.ts'), 'old a\n')
      writeFileSync(join(repo, 'b.ts'), 'old b\n')
      git(['add', '.'])
      git(['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'init'])
      writeFileSync(join(repo, 'a.ts'), 'new a\n')
      writeFileSync(join(repo, 'b.ts'), 'new b\n')
      copyWorkingTreeChanges(repo, dest)
      expect(readFileSync(join(dest, 'a.ts'), 'utf8'), '首条状态码前导空格被 trim').toBe('new a\n')
      expect(readFileSync(join(dest, 'b.ts'), 'utf8')).toBe('new b\n')
    } finally {
      rmSync(repo, { recursive: true, force: true })
      rmSync(dest, { recursive: true, force: true })
    }
  })

  it('@guard-red-sample 硬杀：副本注入后 SIGKILL，真件逐字不变、注入态只在副本、清扫后无残留', async () => {
    const realGuard = join(GUARD_DIR, 'tmp-hygiene.mjs')
    const beforeText = readFileSync(realGuard, 'utf8')
    const beforeMd5 = fileMd5(realGuard)
    const work = mkdtempSync(join(tmpdir(), 'grm-kill-'))
    const marker = join(work, 'ready.txt')
    const childFile = join(work, 'child.mjs')
    const modUrl = new URL('../guard-red-mutation.mjs', import.meta.url).href
    writeFileSync(
      childFile,
      [
        "import fs from 'node:fs'",
        `import { createProbeWorktree, stageInjection } from ${JSON.stringify(modUrl)}`,
        'const marker = process.argv[2]',
        'const wt = createProbeWorktree()',
        "const copy = stageInjection(wt, 'tmp-hygiene', 'scan')",
        "if (!copy) throw new Error('stageInjection returned null')",
        'fs.writeFileSync(marker, wt.dir)',
        'setInterval(() => {}, 1000)',
      ].join('\n')
    )

    const child = spawn(process.execPath, [childFile, marker], { stdio: 'ignore' })
    const exited = new Promise((r) => child.once('exit', r))
    let wtDir = null
    try {
      const deadline = Date.now() + 90000
      while (Date.now() < deadline) {
        if (existsSync(marker)) {
          wtDir = readFileSync(marker, 'utf8').trim()
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }
      expect(wtDir, '子进程未在 90s 内建好注入副本').toBeTruthy()
      const copyPath = join(wtDir, 'tools/v3-guard/tmp-hygiene.mjs')
      expect(readFileSync(copyPath, 'utf8'), '副本必须停在注入态').toContain('return []')
    } finally {
      child.kill('SIGKILL')
      await exited
    }

    // 硬杀发生在「副本已注入」之后：若实现回退成改真件，这里必红
    expect(fileMd5(realGuard), '硬杀后真件 md5 必须不变').toBe(beforeMd5)
    expect(readFileSync(realGuard, 'utf8'), '硬杀后真件内容必须逐字不变').toBe(beforeText)

    const swept = sweepStaleWorktrees()
    expect(swept, '应当清扫掉被硬杀的副本').toBeGreaterThanOrEqual(1)
    expect(existsSync(wtDir), '清扫后副本目录必须消失').toBe(false)
    const list = spawnSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).stdout
    expect(list, 'git worktree 登记不得残留').not.toContain(wtDir)
    rmSync(work, { recursive: true, force: true })
  }, 120000)
})

describe('红样必须自带阴性对照（AGENTS §5.4：负结果不单独成立）', () => {
  const RED = "it('@guard-red-sample 违例 ⇒ 必红', () => {\n  expect(f([])).toEqual(['boom'])\n})\n"
  const CTRL = "it('合规输入 ⇒ 不红', () => {\n  expect(f(['ok'])).toEqual([])\n})\n"

  it('@guard-red-sample 只有红样、没有阴性对照 ⇒ 判红', () => {
    const r = redSampleNeedsControl(RED)
    expect(r.red).toBe(1)
    expect(r.control).toBe(0)
    expect(r.needs).toBe(true)
    const problems = auditControls(['x'], (g) => (g === 'x' ? RED : null))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('没有阴性对照')
  })

  it('红样 + 阴性对照 ⇒ 不判红', () => {
    const r = redSampleNeedsControl(RED + CTRL)
    expect(r.red).toBe(1)
    expect(r.control).toBe(1)
    expect(r.needs).toBe(false)
    expect(auditControls(['x'], () => RED + CTRL)).toEqual([])
  })

  it('没有红样的测试文件不在本判据责任范围（由 skip 那一格负责）', () => {
    expect(redSampleNeedsControl(CTRL).needs).toBe(false)
    expect(auditControls(['x'], () => null)).toEqual([])
  })

  it('@guard-red-sample 多行 expect 里的负结果断言也能被认出（按用例切，不按行切）', () => {
    const multi = [
      "it('真仓当前 = 通过', () => {",
      '  expect(',
      '    audit({',
      '      a: 1,',
      '    })',
      '  ).toEqual([])',
      '})',
      '',
    ].join('\n')
    expect(redSampleNeedsControl(RED + multi).control).toBe(1)
  })
})
