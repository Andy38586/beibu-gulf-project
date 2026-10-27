#!/usr/bin/env node
/**
 * 深路径穿透棘轮 —— `tools/deep-import/baseline.json` 只许**下降或持平**，上涨即红。
 *
 * ## 为什么必须有这条
 *
 * W59 的原始工单是「生产面 79 条深路径 import 穿透模块边界」。取证发现那个数字把两件
 * 不同的事混在一起：311 条深路径里 286 条是**模块内部结构**（`core/map/renderers` ↔
 * `core/map/composables`），真正越界的是另一批。且「越界」此前没有任何判据——
 * `business/index.ts`、`manifest.ts`、`preload.ts` 三个根文件直插 5 个模块内部，
 * `.dependency-cruiser.cjs` 的 21 条规则一条都不拦（`business-cross-import-*` 的
 * from 只覆盖模块目录，不覆盖 business 根）。
 *
 * ## 为什么是棘轮而不是布尔规则
 *
 * 存量 80 条（扫描口径见 `scan.mjs`）。布尔判据要么全红要么全白名单——
 * 白名单要把 80 条路径逐条抄进 `.dependency-cruiser.cjs`，那是 §七-7 要治的
 * 第二份手抄名单。棘轮用「基线只许降」表达同一件事，与 `tools/dup/ratchet.mjs`、
 * `tools/dead-code/ratchet.mjs` 同构（先例：用户 2026-09-26 对 dup 的同一裁定）。
 *
 * ## 口径（与 scan.mjs 同一套，这里只记判据）
 *
 *   · **总量**上涨即红；
 *   · **按目标模块组**各自只许降 —— 防「shared/utils 收敛、core/map 长回来、总量持平」的掩盖；
 *   · `--update` **只许下调**，当前值高于基线时**拒绝执行** —— 上调基线 = 把「上涨即红」作废；
 *   · `--update` **必须带 `--note`**（可带 `--kind`），每次下调追加进 `history` ——
 *     数字下降有两种来源：**真清理**（债少了）与**口径调整**（尺子变了），不分清则历史失真；
 *   · **空集即红**：扫到 0 条而基线非 0，说明扫描条件把 import 全筛掉了或 `frontend/src`
 *     被整体挪走——判据的循环体一次都没执行，不能报通过（W58 同族）。
 *
 * 用法：
 *   node tools/deep-import/ratchet.mjs            # 校验（上涨 exit 1）
 *   node tools/deep-import/ratchet.mjs --update --kind=真清理 --note="为什么下调"
 *   node tools/deep-import/ratchet.mjs --baseline=<另一份基线文件>   # 只读，供测试注入
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { emptyInputProblem } from '../v3-guard/lib/input-set.mjs'

import { scanDeepImports } from './scan.mjs'
import {
  applyRatchetUpdate,
  baselineSelfConflict,
  failRatchet,
  parseRatchetArgs,
  warnBaselineDegradation,
} from '../lib/ratchet-main.mjs'

const TAG = '[deep-import-ratchet]'
const BASELINE_SHAPE = { metric: 'total', items: 'items', byGroup: 'byGroup' }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const BASELINE_PATH = path.join(ROOT, 'tools/deep-import/baseline.json')

/** 当前计数：总量 + 按目标模块组 + 明细（`file → target`，供失败时点名新增了哪几条） */
export function currentCounts() {
  const rows = scanDeepImports()
  const byGroup = {}
  for (const r of rows) byGroup[r.group] = (byGroup[r.group] ?? 0) + 1
  const items = rows.map((r) => ({ file: r.file, target: r.target, group: r.group }))
  return { total: rows.length, byGroup, items }
}

/**
 * 比较（纯函数，便于测）：返回违规列表（空 = 通过）。
 * `baseline.byGroup` 缺失时跳过按组比较 —— 否则首次接线会把存量全判成上涨。
 */
export function compare(current, baseline) {
  const bad = []
  bad.push(...baselineSelfConflict(baseline, BASELINE_SHAPE).errors)
  // 空分母：扫到 0 条而基线非 0 ⇒ 扫描条件失效，不是「债清零了」
  const empty = emptyInputProblem(current.total, {
    what: '深路径穿透',
    hint: 'frontend/src 目录结构没被整体挪走、scanDeepImports 的解析条件没把 import 全筛掉',
  })
  if (empty && baseline.total > 0) bad.push(empty)
  if (current.total > baseline.total) {
    bad.push(`总量上涨：${baseline.total} → ${current.total}（+${current.total - baseline.total}）`)
  }
  if (baseline.byGroup) {
    for (const [g, n] of Object.entries(current.byGroup)) {
      const b = baseline.byGroup[g] ?? 0
      if (n > b) bad.push(`${g} 上涨：${b} → ${n}（+${n - b}）`)
    }
  }
  return bad
}

/** 相对基线新增了哪几条（`file → target` 键）。同数替换（一增一减）不判红，但要点名 */
export function newItems(current, baseline) {
  const known = new Set((baseline.items ?? []).map((i) => `${i.file} → ${i.target}`))
  return current.items.filter((i) => !known.has(`${i.file} → ${i.target}`))
}

function main() {
  const args = parseRatchetArgs(process.argv.slice(2), ['baseline'])
  // `--baseline` 只用于「换一份基线来判」，永远只读：它与 `--update` 同用会把
  // 基线写成另一份文件，等于给「上调基线」开了后门，故直接拒绝。
  if (args.baseline && args.update) {
    console.error('[deep-import-ratchet] --baseline 只读，不能与 --update 同用。')
    process.exit(1)
  }
  const baselinePath = args.baseline ? path.resolve(ROOT, args.baseline) : BASELINE_PATH
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  warnBaselineDegradation(TAG, baseline, BASELINE_SHAPE)
  const current = currentCounts()
  const bad = compare(current, baseline)

  if (args.update) {
    applyRatchetUpdate({
      tag: TAG,
      baselinePath: BASELINE_PATH,
      baseline,
      bad,
      args,
      historyMetrics: { total: current.total },
      nextBaseline: {
        generatedFrom: 'tools/deep-import/scan.mjs',
        total: current.total,
        byGroup: current.byGroup,
        items: current.items,
      },
      downMessage:
        `总量 ${baseline.total} → ${current.total}` +
        `（模块组 ${Object.keys(current.byGroup).length} 个）`,
      rejectAdvice:
        '  上调基线 = 把「上涨即红」这条判据作废。先把新增的穿透收敛成走入口；\n' +
        '  确属框架惯用且不可收敛的，写明理由走评审后并入基线。',
      noteAdvice: '  可另带 --kind=真清理|口径调整（默认「未标注」）。',
    })
    return
  }

  const added = newItems(current, baseline)
  if (bad.length) {
    const extra = []
    if (added.length) {
      extra.push(`  新增穿透 ${added.length} 条（每条都要么收敛成走目标模块入口，要么并入基线）：`)
      added.slice(0, 20).forEach((i) => extra.push(`    ${i.file} → ${i.target}`))
      if (added.length > 20) extra.push(`    ……另 ${added.length - 20} 条`)
    }
    failRatchet(TAG, bad, { extraLines: extra })
  }
  console.log(
    `[deep-import-ratchet] OK：穿透 ${current.total} 条 ≤ 基线 ${baseline.total}` +
      `；模块组 ${Object.keys(current.byGroup).length} 个逐项未涨` +
      (added.length ? `；同数替换 ${added.length} 条（不判红，点名备查）` : '')
  )
  if (added.length) {
    added.slice(0, 20).forEach((i) => console.log(`    ${i.file} → ${i.target}`))
    if (added.length > 20) console.log(`    ……另 ${added.length - 20} 条`)
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
