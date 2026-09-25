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
 * 每个注入点跑完**立即还原**原文件（try/finally 语义，异常也不留脏）。
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
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { EXECUTOR_NAME, executionPlan } from './run-all.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const TEST_DIR = path.join(HERE, '__tests__')
const IS_WIN = process.platform === 'win32'
const NPX = IS_WIN ? 'npx.cmd' : 'npx'

const SELF = 'guard-red-mutation'

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

/** 从守卫源码筛出「可注入」的导出函数名（函数体开头可插语句的那些） */
export function pickInjectables(source, names) {
  return names.filter((n) => source.includes(`export function ${n}`))
}

/** 在指定导出函数的函数体开头注入 `return []`，使其整体失效；找不到锚点返回 null */
export function injectEarlyReturn(source, fnName) {
  const idx = source.indexOf(`export function ${fnName}`)
  if (idx === -1) return null
  const brace = source.indexOf('{', idx)
  if (brace === -1) return null
  return source.slice(0, brace + 1) + '\n  return []\n' + source.slice(brace + 1)
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

/** 跑单个测试文件；输出走 fd，`status=null` 语义由调用方判 error */
function runTestFile(testRel) {
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grm-')), 'out.log')
  const fd = fs.openSync(outFile, 'w')
  const started = Date.now()
  let status = null
  try {
    status = spawnSync(NPX, ['vitest', 'run', '--root', '.', '--dir', 'tools', testRel], {
      cwd: ROOT,
      stdio: ['ignore', fd, fd],
      shell: IS_WIN,
      env: { ...process.env, NODE_OPTIONS: '' },
      timeout: 300000,
    }).status
  } finally {
    fs.closeSync(fd)
  }
  const ms = Date.now() - started
  const tail = fs.readFileSync(outFile, 'utf8').trim().split('\n').slice(-4).join(' | ')
  return { status, ms, tail }
}

/** 探测单个守卫：基线校验 → 逐个注入 → 判定 */
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

  const base = runTestFile(testRel)
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
    fs.writeFileSync(guardPath, mutated)
    let r
    try {
      r = runTestFile(testRel)
    } finally {
      fs.writeFileSync(guardPath, orig)
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

  console.log(
    `[guard-red-mutation] 逐个注入「停用审计函数」并跑该守卫的测试（${guards.length} 个，约 3 分钟）\n`
  )
  const results = []
  for (const g of guards) {
    const r = probeGuard(g)
    results.push(r)
    const icon =
      r.status === 'killed' ? 'killed ✓' : r.status === 'skip' ? 'skip ✗' : r.status.toUpperCase()
    console.log(`  · ${g.padEnd(23)} ${icon.padEnd(14)} ${r.detail ?? ''}`)
  }

  const problems = auditResults(results)
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
