#!/usr/bin/env node
/**
 * metrics-tally — 审查体系自身完整性守卫（第 4 个 v3 守卫）。
 *
 * 原则：审查体系自己是文档，文档会漂移。本脚本把「体系自描述」变成可断言的不变量，
 * 回答 00 §4 无人回答的问题——**谁来审查审查体系**。
 *
 * 守卫的不变量（全部来自 00-审查体系约定.md §3 索引表，权威源）：
 *   1. 各专项指标数 == 00 §3 声明数（57/51/44/45/56/49/45/49），合计 == 396；
 *   2. 00-附录 §8 明细表的每条状态 ∈ {A, B, A-, C, D, 退役}；
 *   3. 00-附录 §4 汇总表的数字 == §8 明细表的实际计数（防两张表漂移）；
 *   4. 同专项内指标编号不重复（v3 追加须带 ′ 后缀，违反 00 §4「尾部追加不重排」即报）。
 *
 * 用法：node tools/v3-guard/metrics-tally.mjs [--json]
 * 返回码：0 = 体系自描述自洽；1 = 存在漂移（CI 可直接挂接）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const APPENDIX = path.join(ROOT, 'docs/根基文档/审查体系专项/00-附录-指标固化状态与迁移路线图.md')

/** 00 §3 索引表声明的指标数（改专项指标数时须先改 00 §3，再改本表） */
const DECLARED = {
  专项1: 57,
  专项2: 51,
  专项3: 44,
  专项4: 45,
  专项5: 56,
  专项6: 49,
  专项7: 45,
  专项8: 49,
}
const STATES = ['A', 'B', 'A-', 'C', 'D', '退役']

const lines = readFileSync(APPENDIX, 'utf8').split(/\r?\n/)

// —— 解析 §8 明细表 ——
const rows = new Map() // 专项 -> [{id, name, level, state}]
let section = null
for (const l of lines) {
  const h = l.match(/^### 专项(\d)/)
  if (h) {
    section = '专项' + h[1]
    if (!rows.has(section)) rows.set(section, [])
    continue
  }
  const m = l.match(/^\|\s*([\d.]+)(′?)\s*\|\s*(.+?)\s*\|\s*(P\d)\s*\|\s*(A-|A|B|C|D|退役)\s*\|/)
  if (m && section) {
    rows.get(section).push({ id: m[1] + m[2], name: m[3], level: m[4], state: m[5] })
  }
}

const problems = []
const summary = []

for (const name of Object.keys(DECLARED)) {
  const list = rows.get(name) || []
  const declared = DECLARED[name]
  const tally = { A: 0, B: 0, 'A-': 0, C: 0, D: 0, 退役: 0 }

  for (const r of list) {
    if (!STATES.includes(r.state)) {
      problems.push(`${name} ${r.id} 状态非法：'${r.state}'（合法值：${STATES.join(' / ')}）`)
      continue
    }
    tally[r.state]++
  }

  // 不变量 1：指标数
  if (list.length !== declared) {
    problems.push(`${name} 指标数漂移：00 §3 声明 ${declared}，附录 §8 实际 ${list.length}`)
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
const declaredTotal = Object.values(DECLARED).reduce((a, b) => a + b, 0)
if (total.总数 !== declaredTotal) {
  problems.push(`指标总数漂移：期望 ${declaredTotal}，实际 ${total.总数}`)
}
for (const l of lines) {
  const m = l.match(
    /^\|\s*(专项\d)\s[^|]*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/
  )
  if (!m) continue
  const s = summary.find((x) => x.专项 === m[1])
  if (!s) continue
  const got = ['总数', 'A', 'B', 'A-', 'C', 'D', '退役'].map((k, i) => Number(m[i + 2]))
  const want = ['总数', 'A', 'B', 'A-', 'C', 'D', '退役'].map((k) => s[k])
  if (got.join() !== want.join()) {
    problems.push(`§4 汇总表与 §8 明细表不一致：${m[1]} 表内 [${got}] vs 实际 [${want}]`)
  }
}

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
