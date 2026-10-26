#!/usr/bin/env node
/**
 * check-tools-skips.mjs — `npm run test:tools` 的 skip/todo 门禁（2026-10-26）。
 *
 * ## 治什么
 * vitest 对 `it.skip` / `it.todo` 只记 skipped，**退出码仍是 0**。实测（CodeBuddy 五轮）：
 * 把 tools/forecast 的承重判据（winner-branches 首条）改成 `it.skip` 后，
 * `npm run test:tools` 仍是 `13 passed | 1 skipped`、exit 0 —— 与全绿不可区分。
 * backend/frontend 有 `scripts/test-watchdog.cjs` + `test-gate.config.json` 的
 * allowSkipped 白名单；tools 侧此前没有任何等价物，本脚本补这一层。
 *
 * ## 做法（最小面）
 * 1. 用 vitest 的 JSON reporter 把结果写进 **os.tmpdir()**（不落仓库根、不落 .local）；
 * 2. default reporter 照常输出到继承的 stdout/stderr（人看到的报告不变）；
 * 3. 解析 `numPendingTests` / `numTodoTests`，同时按 `assertionResults[].status`
 *    交叉核对（防计数字段改名）；>0 就逐条打印 **文件:用例名** 并 exit 1；
 * 4. vitest 自己失败时保留其退出码（skip 检查不掩盖真实红）。
 *
 * 白名单：**无**。tools 下的 pytest 包装器已由
 * `tools/lib/__tests__/python-wrapper-contract.test.mjs` 强制「工具缺失 fail 不 skip」，
 * 其余工具测试没有「按平台跳过」的正当理由；要加例外必须先在本文件显式登记理由。
 *
 * ## 失效条件（写清，不假装）
 * · 若未来 vitest 的 JSON reporter 不再产出 `testResults` / `assertionResults`，
 *   或结果文件读不到，脚本会 **exit 1**（无法判定即判红，门禁不得静默失效）。
 * · 若有人把 `test:tools` 改回裸 `vitest run`，本门禁不执行。
 * · 只覆盖 `test:tools` 的扫描面（tools + scripts）。frontend/backend 走 watchdog。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_STATUSES = new Set(['pending', 'skipped', 'todo'])
const TAG = '[tools-skips]'

/**
 * 从 ROOT 向上找 `node_modules/vitest/vitest.mjs`。
 * 正常仓库根直接命中；临时 worktree 嵌套在仓库 `.local/` 下时也能解析到外层安装，
 * 且不依赖 `require.resolve` 对 package exports 的白名单。
 */
function findVitest(start) {
  let dir = start
  for (;;) {
    const p = path.join(dir, 'node_modules', 'vitest', 'vitest.mjs')
    if (fs.existsSync(p)) return p
    const up = path.dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

const VITEST = findVitest(ROOT)
if (!VITEST) {
  console.error(
    `${TAG} 找不到 vitest 入口（node_modules/vitest/vitest.mjs，从 ${ROOT} 向上查；先 npm ci）`
  )
  process.exit(1)
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-skips-'))
const resultFile = path.join(tmpDir, 'vitest-result.json')
/**
 * `npm run test:tools -- <filter>` 由 npm 追加到 argv。
 * 显式过滤词**取代**默认扫描面（否则与 `tools` 并成 OR，等于跑全量）。
 */
const passthrough = process.argv.slice(2)
const filters = passthrough.length > 0 ? passthrough : ['tools', 'scripts']

let code = 1
let raw = null
try {
  const r = spawnSync(
    process.execPath,
    [
      VITEST,
      'run',
      '--root',
      ROOT,
      '--reporter=default',
      '--reporter=json',
      '--outputFile',
      resultFile,
      ...filters,
    ],
    { cwd: ROOT, stdio: 'inherit' }
  )
  code = r.status ?? 1
  try {
    raw = fs.readFileSync(resultFile, 'utf8')
  } catch {
    raw = null
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

// vitest 真红：保留退出码，不让 skip 检查改写结论
if (code !== 0) {
  console.error(`${TAG} vitest 退出码 ${code}（测试失败/收集失败）；skip 检查不改变结论`)
  process.exit(code)
}

if (raw === null) {
  // 结果文件缺失 = 门禁无法判定。宁可红，不让「读不到」冒充「没有 skip」。
  console.error(`${TAG} 未读到 JSON 结果——跳过检查无法判定，判红`)
  process.exit(1)
}

let result
try {
  result = JSON.parse(raw)
} catch (err) {
  console.error(`${TAG} JSON 解析失败：${err.message}——跳过检查无法判定，判红`)
  process.exit(1)
}
// 兼容历史版本可能包成数组
if (Array.isArray(result)) result = result[0] ?? {}

const trs = Array.isArray(result.testResults) ? result.testResults : null
if (!trs) {
  console.error(
    `${TAG} JSON 无 testResults（vitest 字段变化）⇒ 无法判定 skip，判红（门禁不得静默失效）`
  )
  process.exit(1)
}

const offenders = []
let countedSkips = 0
const rel = (abs) => path.relative(ROOT, path.resolve(abs)).split(path.sep).join('/')
for (const tr of trs) {
  if (!tr || !tr.name) continue
  const file = rel(tr.name)
  for (const a of tr.assertionResults || []) {
    if (!SKIP_STATUSES.has(a.status)) continue
    countedSkips++
    offenders.push(`${file}:${a.fullName || a.title || '(unnamed)'} [${a.status}]`)
  }
}

const pending = result.numPendingTests ?? countedSkips
const todo = result.numTodoTests ?? 0
const total =
  result.numTotalTests ??
  trs.reduce(
    (n, tr) => n + (Array.isArray(tr.assertionResults) ? tr.assertionResults.length : 0),
    0
  )
const passed = result.numPassedTests ?? 0

if (total === 0) {
  console.error(`${TAG} 扫描面为空（total=0）⇒ skip 检查无输入，判红`)
  process.exit(1)
}

if (offenders.length > 0 || pending > 0 || todo > 0) {
  console.error('')
  console.error(`${TAG} 发现被静默跳过的工具测试（skip/todo 一律不许，见 AGENTS §5.4）：`)
  if (offenders.length > 0) {
    for (const line of offenders) console.error(`  - ${line}`)
  } else {
    console.error(`  - 计数显示 pending=${pending} / todo=${todo}，但 JSON 未带逐条详情`)
  }
  console.error(
    `${TAG} 统计：total=${total} passed=${passed} pending=${pending} todo=${todo}；` +
      '若确需平台门控，先在 scripts/check-tools-skips.mjs 登记理由'
  )
  process.exit(1)
}

console.log(`${TAG} OK：tools 测试零 skip/todo（total=${total} passed=${passed}）`)
