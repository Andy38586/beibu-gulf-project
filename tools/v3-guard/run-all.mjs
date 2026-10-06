#!/usr/bin/env node
/**
 * guard:v3 串联执行器（审查 z163）
 *
 * 为什么不用 `&&`：`&&` 链在**第一个非 0 退出**处结束，其后的守卫既不执行也不报错。
 * 守卫自身崩在解析阶段（如读不到文档抛 ENOENT）时，只要它前面的守卫是绿的，断点之后的
 * 新违规就静默漏网——历史上 metrics-tally 断链就是这样把 anchor-check / tmp-hygiene 停掉的。
 *
 * 本器：顺序跑完全部守卫、逐项记录 {code, signal}、末尾统一判定——任一失败即整体 exit 1，
 * 且**跑完全部**（不短路），失败项在汇总表里一眼可见。
 *
 * 用法：node tools/v3-guard/run-all.mjs   （等价于原 `npm run guard:v3`）
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')

/** 执行装置自身的名字：不是一条判据，但它的测试仍在红样/变异复验范围内 */
export const EXECUTOR_NAME = 'run-all'

/** 守卫执行顺序 = 失败反馈优先级（静态 → 契约 → 统计 → 守门） */
export const GUARDS = [
  'no-ephemeral',
  'structure-check',
  'agent-docs-check',
  'routes-audit',
  'constants-audit',
  'css-lint-visibility',
  'forecast-confidence',
  'metrics-tally',
  'ledger-dedupe',
  'doc-numbers',
  'doc-ref-check',
  'doc-claim-numbers',
  'protocol-single-source',
  'doc-map-check',
  'cruise-coverage',
  'nest-controllers',
  'csp-sync',
  'anchor-check',
  'tiles3d-check',
  'tmp-hygiene',
  'guard-red-sample',
  'owned-layers',
  'layer-keys',
  'vue-list-keys',
  'host-object-cast',
  'dev-gated-logs',
  'retired-claims',
  'flyto-single-entry',
  'render-colors-single-source',
  'viewport-tier-single-source',
]

/**
 * 不在快集内、由**另一个入口**跑的守卫（**显式登记，不是静默豁免**）。
 *
 * 为什么要有这张表：目录下新增守卫必须有人跑，但「跑在哪个入口」不总在快集。
 * 只把这些守卫从清单里划掉，就等于让「新守卫被静默遗漏」这条判据失效；所以要求
 * 逐项写明 ① 为何不进快集、② 它在哪个 script 里被跑、③ **哪个自动强制点真的执行它**
 * （`enforcedBy`）。
 *
 * ③ 是 2026-09-25 补的一格：此前只核对「接进了 `ci:local`」，而 `ci:local` 是人手敲的
 * 便利链 —— 结果是这条常设复验装置**在 pre-commit / pre-push / CI 三处都不执行**，
 * 即「从未被自动跑过的门禁」。登记 ≠ 被执行，所以强制点由测试直接读钩子与 workflow 文件
 * 核对（含 `npm run <script>` 的**命令行**，注释与 echo 不算）。
 */
export const SEPARATELY_RUN = [
  {
    name: 'guard-red-mutation',
    why: '单个约 3 分钟（逐个守卫注入「停用审计函数」并跑其测试），不适合 pre-commit 快集',
    script: 'guard:mutation',
    enforcedBy: ['.husky/pre-push', '.github/workflows/ci.yml'],
  },
]

/**
 * 执行计划 = run-all **应当负责跑完**的那些守卫（快集 + 另跑的）。
 *
 * 单独派生出来是为了让「登记了却不在任何计划里」可判：`runAll()` 跑 `GUARDS`，
 * 其余项必须出现在 `SEPARATELY_RUN[].enforcedBy` 指到的强制点里 —— 两者由
 * `run-all.test.mjs` 核对，不靠人记。
 */
export function executionPlan() {
  return [...GUARDS, ...SEPARATELY_RUN.map((g) => g.name)]
}

/**
 * 强制点「真会触发」判据（z063）——**文件在位 ≠ git 会调用它**。
 *
 * 旧断言只证明「enforcedBy 文件里有一行 `npm run <script>`」。实测漏洞：core.hooksPath
 * 没指向 husky 的 shim 目录时，`.husky/pre-push` 一个字节都不会被执行——文件、命令行、
 * 注释全都在，判据却是假绿。所以强制点必须对两件事分别取证：
 *   ① 钩子：hooksPath 下存在同名 shim（或未设 hooksPath 时 `.git/hooks/<name>` 为主档）；
 *   ② workflow：有 `on:` 触发器，且跑该 script 的 job **不带 `if:`**（带条件的 job 可能整段不跑）。
 * 纯函数便于单测与变异复验；真实挂钩点由调用方传文件系统与文本。
 */
export function hookFiringProblems(hooksPath, hookNames, fileExists) {
  const problems = []
  if (!hooksPath) {
    for (const h of hookNames)
      if (!fileExists(`.git/hooks/${h}`))
        problems.push(`core.hooksPath 未设置，且 .git/hooks/${h} 不存在 ⇒ ${h} 不会被 git 触发`)
    return problems
  }
  const dir = hooksPath.replace(/\/+$/, '')
  for (const h of hookNames)
    if (!fileExists(`${dir}/${h}`))
      problems.push(`core.hooksPath=${hooksPath} 下没有 ${h} shim ⇒ .husky/${h} 永远不会被执行`)
  return problems
}

/** workflow 的 `on:` 触发器 + 目标 job 不得带 `if:`（z063；jobOf 由调用方按缩进解析注入） */
export function ciTriggerProblems(text, script, jobOf) {
  const problems = []
  if (!/^on:\s*$/m.test(text)) problems.push('ci.yml 缺顶层 on: 触发器 —— 该 workflow 不会自动跑')
  else if (!/^\s{2}(push|pull_request|workflow_dispatch):/m.test(text))
    problems.push('ci.yml 的 on: 下没有 push/pull_request/workflow_dispatch 之一')
  const job = jobOf(text, script)
  if (!job) problems.push(`ci.yml 里找不到执行 npm run ${script} 的 job`)
  else if (/^\s+if:/m.test(job.block))
    problems.push(`ci.yml 的 job「${job.id}」带 if: 条件 —— 条件不成立时它不跑，等于没挂强制点`)
  return problems
}

/**
 * 顺序执行全部守卫，**不短路**。
 * @param {(name: string) => { code: number|null, signal: string|null }} exec 执行注入点（测试用）
 * @returns {{ results: Array<{name: string, code: number|null, signal: string|null}>, ok: boolean }}
 */
export function runAll(exec = defaultExec) {
  const results = GUARDS.map((name) => ({ name, ...exec(name) }))
  const ok = results.every((r) => r.code === 0 && !r.signal)
  return { results, ok }
}

function defaultExec(name) {
  const file = path.join(HERE, `${name}.mjs`)
  // 脚本缺失按失败处理（原 `&&` 链里缺文件是 node 报错非 0，语义等价）
  if (!fs.existsSync(file)) return { code: null, signal: 'MISSING' }
  const r = spawnSync(process.execPath, [file], { cwd: ROOT, stdio: 'inherit' })
  return { code: r.status, signal: r.signal }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const { results, ok } = runAll()
  const pad = Math.max(...results.map((r) => r.name.length))
  console.log('\n[guard:v3] 汇总（全部执行，不短路）')
  for (const r of results) {
    const good = r.code === 0 && !r.signal
    const tag = r.signal ? `被信号终止（${r.signal}）` : r.code === 0 ? 'OK' : `exit ${r.code}`
    console.log(`  ${good ? '✅' : '❌'} ${r.name.padEnd(pad)}  ${tag}`)
  }
  if (!ok) {
    const bad = results.filter((r) => r.code !== 0 || r.signal)
    console.error(
      `\n[guard:v3] ${bad.length}/${results.length} 项失败：${bad.map((r) => r.name).join('、')}`
    )
    process.exit(1)
  }
  console.log(`[guard:v3] 全部 ${results.length} 项通过`)
}
