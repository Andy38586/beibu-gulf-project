#!/usr/bin/env node
/**
 * 重复表达式棘轮 —— `tools/dup/baseline.json` 只许**下降或持平**，上涨即红。
 *
 * ## 为什么必须有这条
 *
 * `tools/dup/scan.mjs` 的 `compareToBaseline` 自我声明「只报告，不判非零 —— 上闸由用户
 * 裁定」。2026-09-26 复查实证了不上闸的后果：09-25 基线（210 组/4711 token）后仅一天，
 * 正常的 feature/fix 提交就让账面回涨 +6 组/+125 token，全程无任何门禁拦截。
 * 用户已于 2026-09-26 裁定上闸，本器即该裁决的落地；判据与 dead-code 棘轮同构
 * （先例：`tools/dead-code/ratchet.mjs`、`scripts/coverage-ratchet.cjs`）。
 *
 * ## 口径（四条，都是防「账做平了但债没少」）
 *
 *   · **总量**（`totalGroups` / `totalRedundantTokens`）上涨即红；
 *   · **按模块**（单模块组的冗余 token 全额归属；跨模块组入「跨模块」桶）各自只许降 ——
 *     防「A 模块收敛、B 模块长回来、总量持平」的掩盖；
 *   · `--update` **只许下调**，当前值高于基线时**拒绝执行** —— 上调基线 = 把
 *     「上涨即红」作废，棘轮就成了摆设；
 *   · `--update` **必须带 `--note`**（可带 `--kind`），每次下调追加进 `history` ——
 *     数字下降有两种来源：**真清理**（债少了）与**口径调整**（尺子变了），不分清则历史失真。
 *
 * 用法：
 *   node tools/dup/ratchet.mjs            # 校验（上涨 exit 1）
 *   node tools/dup/ratchet.mjs --update --kind=真清理 --note="为什么下调"
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyRatchetUpdate, failRatchet, parseRatchetArgs } from '../lib/ratchet-main.mjs'

const TAG = '[dup-ratchet]'

import { scanDuplication } from './scan.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const BASELINE_PATH = path.join(ROOT, 'tools/dup/baseline.json')

/** 当前计数：总量 + 按模块 + 组明细。模块取路径前三段；组跨模块时冗余 token 入「跨模块」桶 */
export function currentCounts() {
  const {
    groups,
    totalGroups,
    totalRedundantTokens,
    callSiteGroups,
    callSiteTokens,
    moduleDeclGroups,
    moduleDeclTokens,
  } = scanDuplication()
  const byModule = {}
  for (const g of groups) {
    const mods = [...new Set(g.files.map((f) => f.split('/').slice(0, 3).join('/')))]
    const key = mods.length === 1 ? mods[0] : '跨模块'
    byModule[key] = (byModule[key] ?? 0) + g.redundantTokens
  }
  return {
    totalGroups,
    totalRedundantTokens,
    callSiteGroups,
    callSiteTokens,
    moduleDeclGroups,
    moduleDeclTokens,
    byModule,
    groups,
  }
}

/**
 * 比较（纯函数，便于测）：返回违规列表（空 = 通过）。
 * `baseline.byModule` 缺失时跳过按模块比较 —— 否则首次接线会把存量全判成上涨。
 */
export function compare(current, baseline) {
  const bad = []
  if (current.totalGroups > baseline.totalGroups) {
    bad.push(
      `totalGroups 上涨：${baseline.totalGroups} → ${current.totalGroups}` +
        `（+${current.totalGroups - baseline.totalGroups}）`
    )
  }
  if (current.totalRedundantTokens > baseline.totalRedundantTokens) {
    bad.push(
      `totalRedundantTokens 上涨：${baseline.totalRedundantTokens} → ` +
        `${current.totalRedundantTokens}（+${current.totalRedundantTokens - baseline.totalRedundantTokens}）`
    )
  }
  if (baseline.byModule) {
    for (const [mod, n] of Object.entries(current.byModule)) {
      const b = baseline.byModule[mod] ?? 0
      if (n > b) bad.push(`${mod} 冗余 token 上涨：${b} → ${n}`)
    }
  }
  return bad
}

function main() {
  const args = parseRatchetArgs(process.argv.slice(2))
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  const current = currentCounts()
  const bad = compare(current, baseline)

  if (args.update) {
    applyRatchetUpdate({
      tag: TAG,
      baselinePath: BASELINE_PATH,
      baseline,
      bad,
      args,
      historyMetrics: {
        totalGroups: current.totalGroups,
        totalRedundantTokens: current.totalRedundantTokens,
      },
      nextBaseline: {
        generatedFrom: baseline.generatedFrom ?? 'tools/dup/scan.mjs',
        minTokens: baseline.minTokens ?? 12,
        totalGroups: current.totalGroups,
        totalRedundantTokens: current.totalRedundantTokens,
        // D5 降权口径：基线必须同步带这几字段，否则 ratchet 自身测试判「基线形状不对」
        callSiteGroups: current.callSiteGroups,
        callSiteTokens: current.callSiteTokens,
        moduleDeclGroups: current.moduleDeclGroups,
        moduleDeclTokens: current.moduleDeclTokens,
        byModule: current.byModule,
        groups: current.groups,
      },
      downMessage:
        `totalGroups ${baseline.totalGroups} → ${current.totalGroups}；` +
        `totalRedundantTokens ${baseline.totalRedundantTokens} → ${current.totalRedundantTokens}`,
      rejectAdvice:
        '  上调基线 = 把「上涨即红」这条判据作废。先把重复收敛掉；\n' +
        '  确属框架惯用且不可收敛的，写明理由走评审后并入基线。',
      noteAdvice: '  可另带 --kind=真清理|口径调整（默认「未标注」）。',
    })
    return
  }

  if (bad.length) {
    failRatchet(TAG, bad, {
      advice: '  处理：收敛新增的重复表达式；框架惯用且不可收敛的，按 §四 走评审并基线。',
    })
  }
  console.log(
    `[dup-ratchet] OK：重复 ${current.totalGroups} 组 ≤ 基线 ${baseline.totalGroups}；` +
      `冗余 token ${current.totalRedundantTokens} ≤ ${baseline.totalRedundantTokens}` +
      (baseline.byModule
        ? `；模块 ${Object.keys(current.byModule).length} 个逐项未涨`
        : '（基线尚无按模块数据，下次 --update 写入）')
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
