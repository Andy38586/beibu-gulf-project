#!/usr/bin/env node
/**
 * 死物棘轮 —— `dead-code-baseline.json` 只许**下降或持平**，上涨即红。
 *
 * ## 为什么必须有这条
 *
 * `tools/dead-code/scan.mjs` 的注释自己写着「**只报告，不拦截**，退出码恒 0」——
 * 于是 S2 清掉的死物下次再长回来时**没有任何东西会红**：路线图 §二-2
 * 「每类债有基线文件；后续任何一轮改动，它只许下降或持平，上涨即红」在死物这条线上
 * 是空的（基线有了，**红**没有）。本器补上那半条。
 *
 * 先例：`scripts/coverage-ratchet.cjs`（覆盖率棘轮，同一形态）。
 *
 * ## 口径（四条，都是防「账做平了但债没少」）
 *
 *   · **总量**（`totalDead` / `totalRedundantExport`）上涨即红；
 *   · **按模块**（路径前三段）各自只许降 —— 防「A 模块清 5 个、B 模块长 5 个、总量持平」
 *     这种用总量掩盖的单点恶化；
 *   · `--update` **只许下调**，当前值高于基线时**拒绝执行**并说明原因 ——
 *     否则 `--update` 就成了把上涨合法化的后门，「上涨即红」形同虚设；
 *   · `--update` **必须带 `--note`（并可带 `--kind`）**，且每次下调追加进 `history` ——
 *     因为数字下降有两种来源：**真清理**（债少了）与**口径调整**（尺子变了，债没少）。
 *     不区分的话「这个模块清了几个」会被口径变化混掉，历史对比失真
 *     （2026-09-25 实测：一轮里 4 次下调，其中 2 次是口径调整）。
 *
 * 用法：
 *   node tools/dead-code/ratchet.mjs            # 校验（上涨 exit 1）
 *   node tools/dead-code/ratchet.mjs --update --kind=真清理 --note="删 types 13 项零引用类型"
 *   node tools/dead-code/ratchet.mjs --update --kind=口径调整 --note="扫描器把测试目录纳入引用侧"
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { groupByModule, scan } from './scan.mjs'
import { applyRatchetUpdate, failRatchet, parseRatchetArgs } from '../lib/ratchet-main.mjs'

const TAG = '[dead-code-ratchet]'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const BASELINE_PATH = path.join(ROOT, 'tools/dead-code/dead-code-baseline.json')

/** 当前计数（总量 + 按模块 + 明细） */
export function currentCounts() {
  const { dead, redundantExport, emptyModules } = scan()
  const byModule = {}
  for (const [mod, items] of groupByModule(dead)) byModule[mod] = items.length
  return {
    totalDead: dead.length,
    totalRedundantExport: redundantExport.length,
    totalEmptyModule: emptyModules.length,
    byModule,
    dead,
  }
}

/**
 * 三条棘轮口径：`fallback` = 老账本缺该栏时的兜底（`undefined` 沿用「缺栏即放行」；
 * 空模块兜底 0 —— 基线未升级时新造空模块也立刻红），`tail` 只负责消息尾巴。
 */
const RATCHET_FIELDS = [
  { key: 'totalDead', fallback: undefined, tail: (d) => `（+${d}）` },
  { key: 'totalRedundantExport', fallback: undefined, tail: () => '' },
  { key: 'totalEmptyModule', fallback: 0, tail: () => '（空模块不许新增）' },
]

/**
 * 比较（纯函数，便于测）：返回违规列表（空 = 通过）。
 * `baseline.byModule` 缺失时**跳过**按模块比较 —— 否则首次接线会把存量全判成上涨。
 */
export function compare(current, baseline) {
  const bad = []
  for (const { key, fallback, tail } of RATCHET_FIELDS) {
    const base = baseline[key] ?? fallback
    if (current[key] > base) {
      bad.push(`${key} 上涨：${base} → ${current[key]}${tail(current[key] - base)}`)
    }
  }
  if (baseline.byModule) {
    for (const [mod, n] of Object.entries(current.byModule)) {
      const b = baseline.byModule[mod] ?? 0
      if (n > b) bad.push(`${mod} 死物上涨：${b} → ${n}`)
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
        totalDead: current.totalDead,
        totalRedundantExport: current.totalRedundantExport,
      },
      nextBaseline: {
        generatedFrom: baseline.generatedFrom ?? 'tools/dead-code/scan.mjs',
        totalDead: current.totalDead,
        totalRedundantExport: current.totalRedundantExport,
        totalEmptyModule: current.totalEmptyModule,
        byModule: current.byModule,
        dead: current.dead,
      },
      downMessage:
        `totalDead ${baseline.totalDead} → ${current.totalDead}；` +
        `totalRedundantExport ${baseline.totalRedundantExport} → ${current.totalRedundantExport}` +
        `（模块 ${Object.keys(current.byModule).length} 个）`,
      rejectAdvice:
        '  上调基线 = 把「上涨即红」这条判据作废。先把死物清回来；\n' +
        '  若确属必要公开 API，请把理由写进提交并把该条并入基线（需评审）。',
      noteAdvice:
        '  可另带 --kind=真清理|口径调整（默认「未标注」）。\n' +
        '  没有 note 的下调无法与口径调整区分 —— 数字降了不代表债少了。',
    })
    return
  }

  if (bad.length) {
    failRatchet(TAG, bad, {
      advice: '  处理：清掉新增的死物；确属必要公开 API 的，按 §四-10 走评审后并入基线。',
    })
  }
  console.log(
    `[dead-code-ratchet] OK：死物 ${current.totalDead} ≤ 基线 ${baseline.totalDead}；` +
      `冗余导出 ${current.totalRedundantExport} ≤ ${baseline.totalRedundantExport}；` +
      `空模块 ${current.totalEmptyModule} ≤ ${baseline.totalEmptyModule ?? 0}` +
      (baseline.byModule
        ? `；模块 ${Object.keys(current.byModule).length} 个逐项未涨`
        : '（基线尚无按模块数据，下次 --update 写入）')
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
