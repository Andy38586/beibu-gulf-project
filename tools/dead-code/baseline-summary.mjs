#!/usr/bin/env node
/**
 * 死物账「真清理 / 口径调整」派生器（**只读**）。
 *
 * ## 治什么
 *
 * 路线图 §三 S2 窗口 A 结算表原先**手填**「47 → 22（真清理 19；口径调整 7）」。
 * 47 − 22 = 25，而 19 + 7 = 26 —— 数字对不上（实测真清理是 18：−12 与 −6 两笔）。
 * 这和路线图 §一 第 1 条注记是同一个病：**手填的汇总必然漂**。
 *
 * 本器从 `dead-code-baseline.json` 的 `history` 数组派生两组数，逐笔可追，
 * 让文档那格**引用命令**而不是再抄一遍数字。
 *
 * ## 只读
 *
 * 不写 baseline（那是 `ratchet.mjs --update` 的职责），不动棘轮判据。
 * 「真清理」与「口径调整」必须分开：前者是债真的少了，后者只是**扫描口径变了**
 * （把测试目录/工具链纳入引用侧），数字下降不代表清了债 —— 混在一起会虚报战功。
 *
 * ## 判据（哪两条不是空转）
 *
 * · 末条 `totalDead` 必须等于当前基线的 `totalDead` —— 抓「改了基线却没记 history」。
 * · `kind` 必须在 `CLOSING_KINDS` 内 —— 抓「新类别被悄悄并进别的组」。
 *
 * 注意**没有**「分类之和 = 净变化」这条：逐笔差分望远镜求和必然等于首末之差，
 * 它是恒等式，写成断言就是永远红不了的假绿壳。真清理/口径调整各多少由本器**派生**，
 * 与 history 同源，不需要"对账"。
 *
 * 用法：node tools/dead-code/baseline-summary.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BASELINE = path.join(ROOT, 'tools/dead-code/dead-code-baseline.json')

/** 汇总时允许出现的类别（其余一律判为「口径没写清」） */
export const CLOSING_KINDS = ['真清理', '口径调整']

/**
 * 逐笔差分。首条是初值（无前一条可比），不产生差分。
 * @param {Array<{at:string,totalDead:number,kind:string,note?:string}>} history
 */
export function summarize(history) {
  const entries = []
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]
    const cur = history[i]
    entries.push({
      from: prev.totalDead,
      to: cur.totalDead,
      delta: cur.totalDead - prev.totalDead,
      kind: cur.kind,
      at: cur.at,
      note: cur.note ?? '',
    })
  }
  const byKind = {}
  for (const e of entries) byKind[e.kind] = (byKind[e.kind] ?? 0) + e.delta
  const net = history.length > 0 ? history[history.length - 1].totalDead - history[0].totalDead : 0
  return {
    first: history[0] ?? null,
    last: history[history.length - 1] ?? null,
    entries,
    byKind,
    net,
  }
}

/**
 * history 完整性审计。
 * @returns {string[]} 问题列表（空 = 通过）
 */
export function auditHistory(history, { kinds = CLOSING_KINDS, baselineTotal = null } = {}) {
  if (history.length === 0) return ['history 为空 —— 无账可算']
  const { last, byKind } = summarize(history)
  const problems = []
  const unknown = Object.keys(byKind).filter((k) => !kinds.includes(k))
  if (unknown.length > 0) {
    problems.push(
      `未分类的 kind：${unknown.join('、')} —— 汇总口径要显式（允许：${kinds.join('、')}），不许并进别的组`
    )
  }
  if (baselineTotal !== null && last.totalDead !== baselineTotal) {
    problems.push(
      `history 末条 totalDead=${last.totalDead} ≠ 当前基线 totalDead=${baselineTotal} —— ` +
        '有一笔改基线没记 history（账断在中间）'
    )
  }
  return problems
}

function main() {
  const raw = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
  const history = raw.history ?? []
  const { first, last, entries, byKind, net } = summarize(history)

  const parts = Object.entries(byKind)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ')
  console.log(
    `[dead-code-summary] ${first?.totalDead} → ${last?.totalDead}` +
      `（净 ${net >= 0 ? '+' : '−'}${Math.abs(net)}）｜${parts}`
  )
  for (const e of entries) {
    const d = `${e.delta >= 0 ? '+' : '−'}${Math.abs(e.delta)}`
    console.log(
      `  ${String(e.from).padStart(3)} → ${String(e.to).padStart(3)}  ${d.padStart(4)}  ` +
        `${e.kind}  ${e.at}  ${e.note}`
    )
  }

  const problems = auditHistory(history, { baselineTotal: raw.totalDead })
  if (problems.length > 0) {
    console.error('[dead-code-summary] FAIL：')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log(
    `[dead-code-summary] OK：history 末条与当前基线一致（totalDead ${raw.totalDead}），类别均在口径内`
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
