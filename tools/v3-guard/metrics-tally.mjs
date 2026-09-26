#!/usr/bin/env node
/**
 * metrics-tally — 审查体系自身完整性守卫（第 4 个 v3 守卫）。
 *
 * 原则：审查体系自己是文档，文档会漂移。本脚本把「体系自描述」变成可断言的不变量，
 * 回答 约定 §4 无人回答的问题——**谁来审查审查体系**。
 *
 * 守卫的不变量（权威源 = 8 份专项正文；附录是**对账对象**，不是第二份事实）：
 *   1. 附录 §8 各专项条数 == 正文派生计数（正文加/删一条指标，本守卫即知晓）；
 *   2. 附录 §8 明细表的每条状态 ∈ {A, B, A-, C, D, 退役}；
 *   3. 附录 §4 汇总表的数字 == §8 明细表的实际计数（防同一文件两张表漂移）；
 *   4. 同专项内指标编号不重复（v3 追加须带 ′ 后缀，违反 约定 §4「尾部追加不重排」即报）。
 *
 * 用法：node tools/v3-guard/metrics-tally.mjs [--json]
 * 返回码：0 = 体系自描述自洽；1 = 存在漂移（CI 可直接挂接）。
 */
import { readFileSync } from 'node:fs'

import { countBySpec } from '../audit-kit/metrics-index.mjs'
import { crossCheckSummary } from './lib/summary-crosscheck.mjs'
import { APPENDIX, STATES, parseDetailRows } from './lib/appendix-rows.mjs'

/**
 * 期望计数由**专项正文**派生（正文是指标清单的唯一权威源）。
 * 旧版把 57/51/44/45/56/49/45/49 硬抄在这里，于是加一条指标要同时改
 * 正文 / 约定 §3 / 附录 §8 / 附录 §4 / 本表 / metrics:derive —— 手抄必漂移，
 * 且「为审查文档让步」的成本压在施修方身上（2026-09-26 用户裁决改派生）。
 */
const DECLARED = countBySpec()

/**
 * 审计附录：解析 §8 明细表 + 四条不变量（状态合法 / 指标数 / 编号唯一 / 总数）
 * 与汇总表交叉校验。markdown 与 declared 都可注入 —— 否则只能整体读真实附录，
 * 红样喂不进去。（此前本守卫只导出解析器，于是那两条「红样」证的是解析行为，
 * 不是「违例时守卫会红」；用户复核时按假红样记。）
 */
export function auditAppendix(markdown = readFileSync(APPENDIX, 'utf8'), declared = DECLARED) {
  const rows = parseDetailRows(markdown)
  const problems = []
  const summary = []

  for (const name of Object.keys(declared)) {
    const list = rows.get(name) || []
    const want = declared[name]
    const tally = { A: 0, B: 0, 'A-': 0, C: 0, D: 0, 退役: 0 }

    for (const r of list) {
      if (!STATES.includes(r.state)) {
        problems.push(`${name} ${r.id} 状态非法：'${r.state}'（合法值：${STATES.join(' / ')}）`)
        continue
      }
      tally[r.state]++
    }

    // 不变量 1：指标数
    if (list.length !== want) {
      problems.push(`${name} 指标数漂移：专项正文 ${want} 条，附录 §8 明细 ${list.length} 条`)
    }
    // 不变量 4：同专项编号唯一
    const seen = new Set()
    for (const r of list) {
      if (seen.has(r.id)) problems.push(`${name} 指标编号重复：${r.id}（v3 追加须带 ′ 后缀）`)
      seen.add(r.id)
    }

    summary.push({ 专项: name, 总数: list.length, ...tally })
  }

  const total = { A: 0, B: 0, 'A-': 0, C: 0, D: 0, 退役: 0, 总数: 0 }
  for (const s of summary) {
    for (const k of Object.keys(total)) total[k] += s[k]
  }

  // 不变量 3：§4 汇总表与 §8 明细表一致
  const declaredTotal = Object.values(declared).reduce((a, b) => a + b, 0)
  if (total.总数 !== declaredTotal) {
    problems.push(`指标总数漂移：正文合计 ${declaredTotal}，附录 §8 ${total.总数}`)
  }
  // 不变量 3 的判定抽到 lib/summary-crosscheck.mjs（纯函数，配注入测试）：
  // 命中数为 0 一律报错——禁止"解析不到 = 通过"（P1-08 修复）。
  const { problems: summaryProblems } = crossCheckSummary(markdown.split(/\r?\n/), summary)
  problems.push(...summaryProblems)

  return { problems, summary, total }
}

const { problems, summary, total } = auditAppendix()

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ summary, total, problems }, null, 2))
  process.exit(problems.length ? 1 : 0)
}

console.log('专项   | 总数 | A规则 | B测试 | A-待激活 | C配置 | D常驻 | 退役')
for (const s of summary) {
  console.log(
    `${s.专项}  |  ${String(s.总数).padStart(2)}  |  ${String(s.A).padStart(2)}   |  ${String(s.B).padStart(2)}   |    ${String(s['A-']).padStart(2)}    |   ${String(s.C).padStart(2)}   |  ${String(s.D).padStart(3)}  |  ${s.退役}`
  )
}
const pct = (n) => ((n / total.总数) * 100).toFixed(1) + '%'
console.log(
  `\n合计 ${total.总数} 条｜已固化(A+B) ${total.A + total.B} (${pct(total.A + total.B)})｜待激活(A-) ${total['A-']}｜常驻(D) ${total.D} (${pct(total.D)})｜退役 ${total.退役}`
)

if (problems.length) {
  console.log(`\n[metrics-tally] ${problems.length} 处体系自描述漂移：`)
  for (const p of problems) console.log('  - ' + p)
  process.exit(1)
}
console.log('[metrics-tally] OK：审查体系自描述自洽（指标数/状态值/汇总表三处一致）')
