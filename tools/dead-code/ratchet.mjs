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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const BASELINE_PATH = path.join(ROOT, 'tools/dead-code/dead-code-baseline.json')

/** 当前计数（总量 + 按模块 + 明细） */
export function currentCounts() {
  const { dead, redundantExport } = scan()
  const byModule = {}
  for (const [mod, items] of groupByModule(dead)) byModule[mod] = items.length
  return { totalDead: dead.length, totalRedundantExport: redundantExport.length, byModule, dead }
}

/**
 * 比较（纯函数，便于测）：返回违规列表（空 = 通过）。
 * `baseline.byModule` 缺失时**跳过**按模块比较 —— 否则首次接线会把存量全判成上涨。
 */
export function compare(current, baseline) {
  const bad = []
  if (current.totalDead > baseline.totalDead) {
    bad.push(
      `totalDead 上涨：${baseline.totalDead} → ${current.totalDead}` +
        `（+${current.totalDead - baseline.totalDead}）`
    )
  }
  if (current.totalRedundantExport > baseline.totalRedundantExport) {
    bad.push(
      `totalRedundantExport 上涨：${baseline.totalRedundantExport} → ${current.totalRedundantExport}`
    )
  }
  if (baseline.byModule) {
    for (const [mod, n] of Object.entries(current.byModule)) {
      const b = baseline.byModule[mod] ?? 0
      if (n > b) bad.push(`${mod} 死物上涨：${b} → ${n}`)
    }
  }
  return bad
}

function parseArgs(argv) {
  const out = { update: false, note: null, kind: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--update') out.update = true
    else if (argv[i] === '--note') out.note = argv[++i]
    else if (argv[i] === '--kind') out.kind = argv[++i]
  }
  return out
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const update = args.update
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  const current = currentCounts()
  const bad = compare(current, baseline)

  if (update) {
    if (bad.length) {
      console.error('[dead-code-ratchet] 拒绝 --update：当前值高于基线。')
      console.error('  上调基线 = 把「上涨即红」这条判据作废。先把死物清回来；')
      console.error('  若确属必要公开 API，请把理由写进提交并把该条并入基线（需评审）。')
      bad.forEach((b) => console.error('  - ' + b))
      process.exit(1)
    }
    // 强制留痕：数字下降有两种来源（真清理 / 口径调整），不区分就说不清「到底清了几个」
    if (!args.note) {
      console.error('[dead-code-ratchet] --update 必须带 --note="为什么下调"。')
      console.error('  可另带 --kind=真清理|口径调整（默认「未标注」）。')
      console.error('  没有 note 的下调无法与口径调整区分 —— 数字降了不代表债少了。')
      process.exit(1)
    }
    const history = [
      ...(baseline.history ?? []),
      {
        at: new Date().toISOString().slice(0, 10),
        totalDead: current.totalDead,
        totalRedundantExport: current.totalRedundantExport,
        kind: args.kind ?? '未标注',
        note: args.note,
      },
    ]
    const next = {
      generatedFrom: baseline.generatedFrom ?? 'tools/dead-code/scan.mjs',
      totalDead: current.totalDead,
      totalRedundantExport: current.totalRedundantExport,
      byModule: current.byModule,
      dead: current.dead,
      updatedAt: new Date().toISOString().slice(0, 10),
      history,
    }
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + '\n')
    console.log(
      `[dead-code-ratchet] 基线已下调：totalDead ${baseline.totalDead} → ${current.totalDead}；` +
        `totalRedundantExport ${baseline.totalRedundantExport} → ${current.totalRedundantExport}` +
        `（模块 ${Object.keys(current.byModule).length} 个）`
    )
    console.log(`  [${next.history.at(-1).kind}] ${args.note}`)
    return
  }

  if (bad.length) {
    console.error(`[dead-code-ratchet] FAIL：${bad.length} 处上涨（基线只许下降或持平）`)
    bad.forEach((b) => console.error('  - ' + b))
    console.error('  处理：清掉新增的死物；确属必要公开 API 的，按 §四-10 走评审后并入基线。')
    process.exit(1)
  }
  console.log(
    `[dead-code-ratchet] OK：死物 ${current.totalDead} ≤ 基线 ${baseline.totalDead}；` +
      `冗余导出 ${current.totalRedundantExport} ≤ ${baseline.totalRedundantExport}` +
      (baseline.byModule
        ? `；模块 ${Object.keys(current.byModule).length} 个逐项未涨`
        : '（基线尚无按模块数据，下次 --update 写入）')
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
