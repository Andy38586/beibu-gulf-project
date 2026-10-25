#!/usr/bin/env node
/**
 * guard-red-mutation.mjs — 「守卫红样能红」的复验装置（S1.1 出口的机器化）。
 *
 * ## 治什么
 *
 * S1.1 的出口条件是「红样能红（**变异验证**：停用对应分支 ⇒ 该用例失败；只"有标记"不算）」。
 * 但两件事都够不着它：
 *   · `guard-red-sample` 只能证「**有**标记」—— 它自己的注释就写着「有标记但断言只覆盖
 *     正常路径 = 假绿样，本守卫查不出（那要靠变异探针）」；
 *   · `tools/mutation-probe` 的用例**全是业务源码**（`scripts/lib/*`、`backend/src/*`），
 *     一个守卫都没覆盖。
 * ⇒ 这条出口长期只能靠人手工验一次；**改一次守卫，假绿样可以静默回来**（与路线图 §一
 * 「守卫在跑、但从未证明违例时会红」同一形状，只是从「守卫」推进到「标记」后停住了）。
 *
 * ## 做法
 *
 * 对每个 v3 守卫，把它**被测试 import 的审计函数**整体停用（函数体开头注入 `return []`），
 * 跑该守卫自己的测试：
 *   · 变红 ⇒ `killed`（红样咬的是承重判据，约束成立）；
 *   · 仍绿 ⇒ `survived`（假绿样，必须补强断言）。
 * 每个注入点跑完**立即还原**（try/finally 语义，异常也不留脏）。
 *
 * ## 注入面（F101 B，用户 2026-10-25 裁定 B）
 *
 * **绝不在工作树真件上注入**。旧版直接改 `tools/v3-guard/<guard>.mjs` 再还原；硬杀
 * （Ctrl+C / 任务被杀 / 断电）会把 `return []` 留在真件里，实测已留下注入态——这等于
 * 复验装置自己制造了它要抓的「假守卫」。
 *
 * 现在每次复验建一个**临时 git worktree**（`.local/tmp/grm-wt-<pid>-<ts>`）：
 *   · worktree 是完整仓库副本，守卫里的 `ROOT=../..`、`git ls-files`、真文档读取都照常成立
 *     （纯拷贝目录做不到这点：git 索引会空、路径基准会错）；
 *   · 注入只写 worktree 内的副本，真件 md5 前后一致（`probeGuard` 每次自检并在变化时判 error）；
 *   · 正常退出 `git worktree remove --force` 清理；硬杀遗留的目录由下次启动
 *     `sweepStaleWorktrees()` 清扫（按文件名里的 pid 判断，活进程的副本不动）。
 *
 * 不用「拷 tools/v3-guard 树 + 改相对 import」：守卫测试大量依赖仓库根锚点
 * （`git show :docs/...`、`.husky`、真 `frontend/src`），改 import 只能解决模块解析，
 * 解决不了「ROOT 指到临时目录后读到的是另一棵树」——那会让基线判断失真。
 *
 * ## 四条防自欺的口径（都是踩过的坑换来的）
 *
 * 1. **子进程输出走文件描述符，不用管道**。受限环境拒绝管道式子进程，spawnSync 返回
 *    `status=null`；把它当成「测试变红」会得到**一整片假的 KILLED** —— 本文件第一版实测
 *    19/19 全红、总耗时 1 秒（根本没跑）。`status=null` 一律判 `error`。
 * 2. **先跑未变异基线**。基线非绿 ⇒ 记 `error` 而不是「能红」—— 不许拿「测试本来就红」
 *    冒充「变异让它红」。
 * 3. **耗时随结果输出**。秒级完成 = 没跑，是自检信号，不是性能优化。
 * 4. **`skip` 不是放行**（2026-09-25 补）。旧版把「该守卫没有 test 文件」记成 skip 并
 *    直接 continue，而成功文案写的是全称判断 —— 于是**摘掉或改名某个守卫的 test 文件，
 *    该守卫就整体退出复验且装置照报 OK**，本装置自己犯的正是它要治的病（04-F1）。
 *    现在 skip 计入问题、且必须显式登记才豁免；成功文案改成带计数的非全称判断。
 * 5. **注入点取函数体、注入物过解析**（2026-10-09）。旧版取第一个 `{`，对解构参数
 *    （`function f({ a } = {})`）会把 `return []` 插进参数表 ⇒ 子进程 parse error 被记成
 *    `killed`（假杀；`tools/diag/probe-guard-injection-syntax.mjs` 实测 8/28 命中）。
 * 6. **写回带重试**（2026-10-09）。变异对着子进程刚读过的文件写回，Windows 实测连崩 3 次。
 *
 * ## 用法
 *
 *   node tools/v3-guard/guard-red-mutation.mjs            # 全部守卫（约 3 分钟）
 *   node tools/v3-guard/guard-red-mutation.mjs --only x   # 只跑某个守卫
 *
 * 清单来源 = `run-all.mjs` 的执行计划 + 执行装置（见 `guardsToProbe`），**不 readdir 目录**。
 * 退出码：0 = 全部 killed（或已登记豁免）；1 = 存在未登记的 survived / error / skip。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { EXECUTOR_NAME, executionPlan } from './run-all.mjs'
// 红样标记与「必须有阴性对照」是同一件事的两面：标记说「我负责红样」，
// 对照说「我还证明了合规时不红」。两处必须读同一个常量，否则改名即静默失配。
import { MARKER } from './guard-red-sample.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const SELF = 'guard-red-mutation'

/** 前缀含 pid：下次启动只清扫「进程已不在」的副本，不误删并行运行的另一个复验 */
const WORKTREE_PREFIX = 'grm-wt-'
/** vitest 入口（直接 node 调用，不依赖 npx 解析与 shell；受限环境实测更稳） */
const VITEST_BIN = path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')

/**
 * 棘轮基线：已知无法做「停用审计函数」注入的守卫（逐项登记并写明理由，不许悄悄扩大）。
 * 新增守卫**不得**直接进本表 —— 不可注入即判 error。
 */
export const BASELINE = []

/** 从测试源码提取 `import { ... } from '../<guard>.mjs'` 的导出名 */
export function importedNames(testSource) {
  const m = testSource.match(/import\s*\{([^}]+)\}\s*from\s*'\.\.\/[^']+'/)
  if (!m) return []
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^type\s+/, ''))
    .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))
}

/**
 * 红样必须自带**阳性对照**（AGENTS §5.4「负结果不单独成立」）。
 *
 * ## 治的失效（连续四笔踩过）
 *
 * 「把某段收集代码包进 `if (false)`」这类变异，在**真实仓库本来就是空的**时候，
 * 与「算出 0」表现完全一样 —— 测试照绿。四次实测：
 *   · PD-1 M6（去掉行首锚定 → 负样本覆盖不足）
 *   · PD-2 M2c（正向校验只有端到端兜底，夹具没咬住）
 *   · PD-3 M4（判据钉死文案措辞，等价改写误红）
 *   · PA-3 M2（真实仓库空模块 = 0，停用收集仍是 0）
 * 按 AGENTS §十「同一形态第 3 次出现 ⇒ 升格为门禁」，本条把「有阳性对照」变成可判的事实：
 *
 * 判据：测试文件里，**能红的用例**（含 `@guard-red-sample` 标记）之外，必须另有
 * **能绿的用例**（断言 `toBe(0)` / `toEqual([])` / `not.toThrow()` / `not.toContain`
 * 这类「负结果」断言）。只有红样、没有阴性对照 ⇒ 红。
 *
 * 为什么限定「负结果断言」：阳性对照的作用是证明「同一装置、合规输入下不红」。
 * 只断言 `toBe(1)`（红）的用例不承担这个职责 —— 那只是第二条红样。
 */
export function redSampleNeedsControl(testSource) {
  const lines = testSource.split(/\r?\n/)
  // 用例之间的边界只看**顶层** `it(` / `test(`（行首两个空格内），
  // 否则多行 `expect(\n  audit(...)\n).toEqual([])` 会被切到上一个用例之外。
  const isCaseStart = (l) => /^ {0,2}(it|test)\s*\(/.test(l)
  const cases = []
  let cur = null
  for (let i = 0; i < lines.length; i++) {
    if (isCaseStart(lines[i])) {
      if (cur) cases.push(cur)
      cur = { line: i + 1, text: lines[i], body: [] }
    }
    if (cur) cur.body.push(lines[i])
  }
  if (cur) cases.push(cur)

  const isNegative = (body) =>
    /expect\([\s\S]*?\)\.toEqual\(\s*\[\s*\]\s*\)/.test(body) ||
    /expect\([\s\S]*?\)\.toBe\(\s*0\s*\)/.test(body) ||
    /\.not\.toThrow\(/.test(body) ||
    /\.not\.toContain/.test(body) ||
    /\.toBeNull\(/.test(body)

  const red = cases.filter((c) => c.body[0].includes(MARKER))
  const control = cases.filter((c) => isNegative(c.body.join('\n')))
  return { red: red.length, control: control.length, needs: red.length > 0 && control.length === 0 }
}

/** 从守卫源码筛出「可注入」的导出函数名（函数体开头可插语句的那些） */
export function pickInjectables(source, names) {
  return names.filter((n) => source.includes(`export function ${n}`))
}

/**
 * 找导出函数的函数体起始花括号：从参数表开括号起按括号深度找配对的 `)`，
 * 再取其后的第一个 `{`。解构参数（`{ a } = {}`）里的花括号因此不会被当成函数体。
 */
function findBodyBrace(source, fromIdx) {
  const open = source.indexOf('(', fromIdx)
  if (open === -1) return -1
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (depth === 0) return source.indexOf('{', i + 1)
    }
  }
  return -1
}

/** 在指定导出函数的函数体开头注入 `return []`，使其整体失效；找不到锚点返回 null */
export function injectEarlyReturn(source, fnName) {
  const idx = source.indexOf(`export function ${fnName}`)
  if (idx === -1) return null
  const brace = findBodyBrace(source, idx + `export function ${fnName}`.length)
  if (brace === -1) return null
  return source.slice(0, brace + 1) + '\n  return []\n' + source.slice(brace + 1)
}

/** 注入产物必须仍是合法模块：否则"子进程非零"只是解析错误，不是判据咬住了 */
export function parsesModule(source) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grm-syn-')), 'probe.mjs')
  fs.writeFileSync(file, source)
  return spawnSync(process.execPath, ['--check', file], { stdio: 'ignore' }).status === 0
}

/**
 * 写文件带重试：子进程刚读过目标文件时写回可能短暂失败（见头注 6）。
 * 重试尽仍失败才抛错——此时装置中止，**只影响临时副本**，真件不动。
 */
function writeFileRetry(file, content) {
  for (let i = 1; ; i++) {
    try {
      fs.writeFileSync(file, content)
      return
    } catch (err) {
      if (i >= 15) throw err
      const until = Date.now() + 100
      while (Date.now() < until) {
        // 同步自旋等待：本装置全同步执行，让出事件循环也无人接手
      }
    }
  }
}

/** 文件 md5：用于「真件在复验期间未被改动」的运行时自检 */
export function fileMd5(file) {
  return createHash('md5').update(fs.readFileSync(file)).digest('hex')
}

function runGit(args, { cwd = ROOT, trim = true } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 120000 })
  const out = r.stdout ?? ''
  return { status: r.status, out: trim ? out.trim() : out, err: (r.stderr ?? '').trim() }
}

/**
 * 解析 `git status --porcelain=v1 -z` 原始输出。
 *
 * 不得先 trim：首条修改的状态码是「空格 + M」（工作区改动），trim 会把状态码前导
 * 空格吃掉，随后 `slice(3)` 少切一位、路径首字母丢失 —— 第一个修改文件永远复制不进
 * 副本，基线就会拿 HEAD 版本判绿（实测：f101-b 首个改动文件 flood colors 被漏拷）。
 */
export function parsePorcelainZ(raw) {
  return raw
    .split('\0')
    .filter(Boolean)
    .map((entry) => ({ code: entry.slice(0, 2), rel: entry.slice(3) }))
    .filter((e) => e.rel)
}

/** pid 是否仍存活；EPERM（无权限发信号）按「活着」保守处理，避免误删并行副本 */
function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

/** 删除目录，但不跟随 symlink/junction（worktree 内本不该有，防御性） */
function removeTreeNoFollow(dir) {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isSymbolicLink()) fs.unlinkSync(p)
    else if (e.isDirectory()) removeTreeNoFollow(p)
    else fs.unlinkSync(p)
  }
  fs.rmdirSync(dir)
}

/** 把工作区里「已修改/已暂存/未跟踪」的文件覆盖进 worktree（HEAD 版本会丢当前改动） */
export function copyWorkingTreeChanges(root, dir) {
  const st = runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], {
    cwd: root,
    trim: false,
  })
  if (st.status !== 0) throw new Error(`git status 失败：${st.err || st.out}`)
  for (const { code, rel } of parsePorcelainZ(st.out)) {
    const from = path.join(root, rel)
    const to = path.join(dir, rel)
    if (code.includes('D') || !fs.existsSync(from)) {
      fs.rmSync(to, { recursive: true, force: true })
      continue
    }
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }
}

/** 临时 worktree 落点（每次复验会话一个） */
function worktreeParent(root) {
  return path.join(root, '.local', 'tmp')
}

/**
 * 建临时注入副本（**唯一**允许写入的注入面）。
 *
 * 为什么是 git worktree 而不是拷目录：守卫测试的锚点是仓库根（`ROOT=../..`），
 * 会读 `git ls-files` / `git show :docs/...` / `.husky` / 真 `frontend/src`。
 * 只拷 `tools/v3-guard` 再改相对 import，模块能解析，但这些锚点会指向另一棵树，
 * 基线判断失真（实测纯拷贝下 doc-ref-check 的 git 索引为空、基线直接红）。
 */
export function createProbeWorktree({ root = ROOT } = {}) {
  if (!fs.existsSync(path.join(root, '.git'))) {
    throw new Error(`${root} 不是 git 仓库，无法创建注入副本`)
  }
  const parent = worktreeParent(root)
  fs.mkdirSync(parent, { recursive: true })
  sweepStaleWorktrees({ root })

  const dir = path.join(parent, `${WORKTREE_PREFIX}${process.pid}-${Date.now()}`)
  const add = runGit(['worktree', 'add', '--detach', dir, 'HEAD'], { cwd: root })
  if (add.status !== 0) throw new Error(`git worktree add 失败：${add.err || add.out}`)

  try {
    copyWorkingTreeChanges(root, dir)
    // 守卫树用工作区当前版本整体覆盖：worktree 是 HEAD 版本，未提交的守卫/测试改动会丢
    const src = path.join(root, 'tools', 'v3-guard')
    const dst = path.join(dir, 'tools', 'v3-guard')
    fs.cpSync(src, dst, { recursive: true, force: true })
  } catch (err) {
    removeProbeWorktree(dir, { root })
    throw err
  }
  return { dir, root }
}

/** 删除一个注入副本：先走 git worktree remove，失败再按不跟随符号链接的方式硬删 */
export function removeProbeWorktree(dir, { root = ROOT } = {}) {
  if (!dir) return
  if (fs.existsSync(dir)) {
    const r = runGit(['worktree', 'remove', '--force', dir], { cwd: root })
    if (r.status !== 0 && fs.existsSync(dir)) removeTreeNoFollow(dir)
  }
  runGit(['worktree', 'prune'], { cwd: root })
}

/**
 * 清扫硬杀遗留的副本（正常退出由 `cleanupProbeWorktree` 负责）。
 *
 * 只看文件名里的 pid：活进程的副本不动（并行跑两个复验时不能互删）；
 * 本进程的会话副本也不动（由 finally 清理）。
 */
export function sweepStaleWorktrees({ root = ROOT } = {}) {
  const parent = worktreeParent(root)
  if (!fs.existsSync(parent)) return 0
  let swept = 0
  for (const name of fs.readdirSync(parent)) {
    if (!name.startsWith(WORKTREE_PREFIX)) continue
    const pid = Number(name.slice(WORKTREE_PREFIX.length).match(/^(\d+)-/)?.[1] ?? 0)
    if (pid === process.pid) continue
    if (pid && pidAlive(pid)) continue
    removeProbeWorktree(path.join(parent, name), { root })
    swept++
  }
  runGit(['worktree', 'prune'], { cwd: root })
  return swept
}

/** 会话级单例：一次 `guard:mutation` 只建一个 worktree（建一次约 7s，不能每守卫建） */
let sessionWorktree = null

export function ensureProbeWorktree() {
  if (!sessionWorktree) sessionWorktree = createProbeWorktree()
  return sessionWorktree
}

export function cleanupProbeWorktree() {
  if (!sessionWorktree) return
  removeProbeWorktree(sessionWorktree.dir)
  sessionWorktree = null
}

/**
 * 在副本里注入某守卫的某函数（测试/硬杀自测用；**不碰真件**）。
 * @returns {string|null} 被注入的副本路径；找不到注入锚点返回 null
 */
export function stageInjection(wt, guardName, fnName) {
  const real = path.join(HERE, `${guardName}.mjs`)
  const copy = path.join(wt.dir, 'tools', 'v3-guard', `${guardName}.mjs`)
  const mutated = injectEarlyReturn(fs.readFileSync(real, 'utf8'), fnName)
  if (mutated === null) return null
  writeFileRetry(copy, mutated)
  return copy
}

/** 判定（纯函数，便于红样测试）：返回问题列表（空 = 通过） */
export function auditResults(results, { baseline = BASELINE } = {}) {
  const problems = []
  for (const r of results) {
    if (r.status === 'killed') continue
    if (baseline.includes(r.guard)) continue
    if (r.status === 'skip') {
      // skip 曾经是"合法放行"：摘掉或改名某个守卫的 test 文件，该守卫就整体退出复验且
      // 装置仍报「每个守卫的红样都咬住了判据」—— 这正是本装置自己治的病（04-F1）。
      problems.push(
        `${r.guard}: skip（${r.detail ?? '无测试文件'}）—— 没有 test = 该守卫整体退出红样` +
          '复验，不是放行理由；补 test 或按登记流程走豁免，别让它静默出局'
      )
      continue
    }
    problems.push(`${r.guard}: ${r.status}${r.detail ? ' — ' + r.detail : ''}`)
  }
  return problems
}

/**
 * 判据：有红样的守卫，其测试里必须有阴性对照（见 `redSampleNeedsControl` 头注）。
 * @param {(guard:string)=>string|null} readTest 读测试源码（无测试返回 null）
 */
export function auditControls(guards, readTest) {
  const problems = []
  for (const g of guards) {
    const src = readTest(g)
    if (!src) continue // 无测试由 skip 那一格负责
    const r = redSampleNeedsControl(src)
    if (r.needs) {
      problems.push(
        `${g}: 有 ${r.red} 条红样但没有阴性对照 —— 红样只证明「违例时会红」，` +
          `证明不了「合规时不红」。真实仓库恰好为空时，停用判据与算出 0 表现一样，` +
          `这类假绿连续踩过四次（PD-1 M6 / PD-2 M2c / PD-3 M4 / PA-3 M2）。` +
          `补一条断言负结果的用例（toBe(0) / toEqual([]) / not.toThrow）。`
      )
    }
  }
  return problems
}

/** 跑单个测试文件；输出走 fd，`status=null` 语义由调用方判 error */
function runTestFile(testRel, cwd = ROOT) {
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grm-')), 'out.log')
  const fd = fs.openSync(outFile, 'w')
  const started = Date.now()
  let status = null
  try {
    if (!fs.existsSync(VITEST_BIN)) {
      fs.writeSync(fd, `vitest 入口不存在：${VITEST_BIN}`)
    } else {
      status = spawnSync(
        process.execPath,
        [VITEST_BIN, 'run', '--root', '.', '--dir', 'tools', testRel],
        {
          cwd,
          stdio: ['ignore', fd, fd],
          env: { ...process.env, NODE_OPTIONS: '' },
          timeout: 300000,
        }
      ).status
    }
  } finally {
    fs.closeSync(fd)
  }
  const ms = Date.now() - started
  const tail = fs.readFileSync(outFile, 'utf8').trim().split('\n').slice(-4).join(' | ')
  return { status, ms, tail }
}

/**
 * 探测单个守卫：建副本 → 基线校验 → 逐个注入（只写副本）→ 判定。
 *
 * 真件只读：进出各取一次 md5，任何变化都判 `error`（不是「差不多就行」）。
 * 这既防实现回退到「改真件再还原」，也防测试/子进程意外写入守卫源。
 */
export function probeGuard(guardName, { guardDir = HERE, root = ROOT } = {}) {
  const guardPath = path.join(guardDir, `${guardName}.mjs`)
  const testRel = path.join('tools/v3-guard/__tests__', `${guardName}.test.mjs`)
  const testAbs = path.join(root, testRel)
  if (!fs.existsSync(testAbs))
    return { guard: guardName, status: 'skip', detail: `无测试文件（缺 ${testRel}）` }

  const orig = fs.readFileSync(guardPath, 'utf8')
  const injectables = pickInjectables(orig, importedNames(fs.readFileSync(testAbs, 'utf8')))
  if (injectables.length === 0) {
    return {
      guard: guardName,
      status: 'error',
      detail: '无可注入的导出函数（新增即须补红样或入基线）',
    }
  }

  // 自定义 root/guardDir 是单测夹具（如「无 test 文件」），没有完整仓库可建 worktree。
  // 不提供「就地注入」的降级路径：那条路正是硬杀留注入态的根因。
  if (root !== ROOT || guardDir !== HERE) {
    return {
      guard: guardName,
      status: 'error',
      detail: '自定义 root/guardDir 不支持副本注入（临时 worktree 需真实仓库根）',
    }
  }

  const beforeHash = fileMd5(guardPath)

  const runProbe = () => {
    const wt = ensureProbeWorktree()
    const guardRel = path.join('tools', 'v3-guard', `${guardName}.mjs`)
    const wtGuard = path.join(wt.dir, guardRel)
    const wtTest = path.join(wt.dir, testRel)
    // 每守卫都从真件刷新副本：上一守卫若异常，副本里可能残留注入
    fs.copyFileSync(guardPath, wtGuard)
    fs.copyFileSync(testAbs, wtTest)

    const base = runTestFile(testRel, wt.dir)
    if (base.status !== 0) {
      return {
        guard: guardName,
        status: 'error',
        detail: `基线非绿（status=${base.status}，${base.ms}ms）—— 测试本身就红，无法判定能红性`,
      }
    }

    const tried = []
    for (const fn of injectables) {
      const mutated = injectEarlyReturn(orig, fn)
      if (mutated === null) continue
      if (!parsesModule(mutated)) {
        return {
          guard: guardName,
          status: 'error',
          detail: `停用 ${fn} 后源码解析失败（假杀形状）；注入器必须落在函数体上`,
        }
      }
      writeFileRetry(wtGuard, mutated)
      let r
      try {
        r = runTestFile(testRel, wt.dir)
      } finally {
        writeFileRetry(wtGuard, orig)
      }
      if (r.status === null) {
        return {
          guard: guardName,
          status: 'error',
          detail: `停用 ${fn} 后子进程未起（status=null）`,
          ms: r.ms,
        }
      }
      tried.push(`${fn}:${r.status === 0 ? '仍绿' : `红(${r.status},${r.ms}ms)`}`)
      if (r.status !== 0) {
        return {
          guard: guardName,
          status: 'killed',
          detail: `停用 ${fn} ⇒ 测试 exit ${r.status}`,
          ms: r.ms,
        }
      }
    }
    return {
      guard: guardName,
      status: 'survived',
      detail: `停用 ${injectables.join('/')} 后测试仍绿（${tried.join(' ')}）—— 红样没咬住承重判据`,
    }
  }

  let result
  try {
    result = runProbe()
  } catch (err) {
    result = {
      guard: guardName,
      status: 'error',
      detail: `副本注入流程异常：${err instanceof Error ? err.message : String(err)}`,
    }
  }

  try {
    if (fileMd5(guardPath) !== beforeHash) {
      result = {
        guard: guardName,
        status: 'error',
        detail:
          `真件 md5 在复验期间变化（${beforeHash} → ${fileMd5(guardPath)}）—— ` +
          '注入只能写 worktree 副本，真件必须前后一致',
      }
    }
  } catch (err) {
    result = {
      guard: guardName,
      status: 'error',
      detail: `复验后读不到真件：${err instanceof Error ? err.message : String(err)}`,
    }
  }
  return result
}

function parseArgs(argv) {
  const i = argv.indexOf('--only')
  return { only: i === -1 ? null : argv[i + 1] }
}

/**
 * 要复验的守卫清单 —— **从 run-all 的登记派生**，不 readdir。
 *
 * readdir 版会把「目录里有但没人登记的 .mjs」也算成守卫（分母跟着文件数漂），
 * 而登记集才是"谁该被跑"的权威源。执行装置 `run-all` 另算进来：它不是一条判据，
 * 但它的测试必须一起被复验（否则"摘掉 run-all 的短路断言"没人发现）。自身除外 ——
 * 本装置不能注入自己（会一边跑一边改自己）。
 */
export function guardsToProbe() {
  return [...new Set([...executionPlan(), EXECUTOR_NAME])].filter((n) => n !== SELF).sort()
}

function main() {
  const { only } = parseArgs(process.argv.slice(2))
  const guards = guardsToProbe().filter((n) => !only || n === only)

  if (guards.length === 0) {
    console.error(`[guard-red-mutation] 没有匹配的守卫：${only}`)
    process.exit(1)
  }

  // 硬杀（SIGKILL）无法拦截，但 Ctrl+C / SIGTERM 要先把副本清掉；
  // 真正的硬杀残留由下次启动的 sweepStaleWorktrees 兜底。
  const onSignal = (sig) => {
    cleanupProbeWorktree()
    process.exit(sig === 'SIGINT' ? 130 : 143)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  const swept = sweepStaleWorktrees()
  console.log(
    `[guard-red-mutation] 逐个注入「停用审计函数」并跑该守卫的测试（${guards.length} 个，约 3 分钟）\n` +
      `  注入面 = 临时 git worktree（真件只读）${swept ? `；已清扫 ${swept} 个硬杀残留` : ''}\n`
  )
  const results = []
  try {
    for (const g of guards) {
      const r = probeGuard(g)
      results.push(r)
      const icon =
        r.status === 'killed' ? 'killed ✓' : r.status === 'skip' ? 'skip ✗' : r.status.toUpperCase()
      console.log(`  · ${g.padEnd(23)} ${icon.padEnd(14)} ${r.detail ?? ''}`)
    }
  } finally {
    cleanupProbeWorktree()
  }

  const problems = auditResults(results)
  // 阴性对照判据：红样只证明「违例时会红」，还须证明「合规时不红」
  const testRel = (n) => `tools/v3-guard/__tests__/${n}.test.mjs`
  const controls = auditControls(guards, (n) => {
    const p = path.join(ROOT, testRel(n))
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  })
  problems.push(...controls)
  const killed = results.filter((r) => r.status === 'killed').length
  const skipped = results.filter((r) => r.status === 'skip').length
  console.log(
    `\n[guard-red-mutation] killed ${killed} · skip ${skipped} · 问题 ${problems.length}` +
      `（豁免基线 ${BASELINE.length} 项）`
  )
  if (problems.length === 0) {
    // 带计数的非全称判断：以前的「每个守卫的红样都咬住承重判据」在 skip>0 时也是假的
    console.log(
      `[guard-red-mutation] OK：${killed}/${guards.length} 项的红样咬住承重判据` +
        `（skip ${skipped} · survived 0 · error 0；执行装置 ${EXECUTOR_NAME} 亦在复验之列）`
    )
    return
  }
  console.error('[guard-red-mutation] FAIL：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
