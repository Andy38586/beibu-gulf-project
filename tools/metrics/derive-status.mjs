#!/usr/bin/env node
/**
 * 指标账派生器 —— 附录 §8 的固化状态列**由证据映射推导**，不再手填。
 *
 * ## 为什么必须有这条
 *
 * 附录 §8 的状态列在 2026-09-09 重建时是占位值（全 C，条数随正文派生，不在此写死）（全 C，原文声明「逐条复核前不得
 * 视为真实固化证据」）——手填 + 整列同值，正是路线图 S3 指标账出口要消灭的两个特征。
 *
 * ## 口径
 *
 *   · 证据映射 `tools/metrics/evidence.json`：指标编号（形如 专项1:2.4，全限定防跨专项撞号）
 *     → { kind, refs, by }。refs 是**数组**：一条指标可由多个守卫共同固化（如「文档自称计数
 *     必须同源」由 metrics-tally / ledger-dedupe / doc-numbers / doc-claim-numbers 各守一种载体），
 *     一个守卫也可固化多条不同指标（如 structure-check 同时守体量棘轮与模块结构）。
 *     kind=guard ⇒ refs 里每个文件必须存在**且**在 run-all 执行计划里 ⇒ 派生 A；
 *     kind=test  ⇒ ref 文件存在 ⇒ 派生 B；
 *     kind=retired ⇒ 派生 退役；
 *     无映射 ⇒ C（占位，诚实表示"暂无固化证据"）。
 *   · ref 文件不存在或 guard 未被 run-all 登记 ⇒ 本器直接红（防止守卫被删后映射仍称固化）。
 *   · **反向校验**：run-all 执行计划里的每个守卫都必须在本表出现至少一次，否则红——
 *     W74：此前只有「登记了但守卫没了」这一向，「守卫在跑但没登记固化哪条指标」无代码路径，
 *     于是 29 个执行体只登记了 2 条、99.5% 的指标停在 C 级却一路 exit 0。
 *   · 校验模式（默认）：§8 逐行状态必须 == 派生值，否则 exit 1 ——
 *     状态列的唯一合法写法是改证据映射后跑 --write（手改即红）。
 *   · --write：按派生值重写 §8 状态列并重算 §4 汇总计数（幂等；表对齐交给 prettier）。
 *
 * ## 新守卫登记义务（S5 起为常态）
 *
 * 新增守卫/判据时，必须同时在 evidence.json 登记它固化的指标编号——
 * 没有登记的固化不算固化（与守卫红样同款纪律：没有执行体的声称等于没有）。
 *
 * 用法：
 *   node tools/metrics/derive-status.mjs           # 校验（漂移 exit 1）
 *   node tools/metrics/derive-status.mjs --write   # 按派生值重写 §8 与 §4
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { countBySpec } from '../audit-kit/metrics-index.mjs'
// F-01（2026-10-05）：状态值域与附录 row 解析器同源（此前本文件自带第二套正则，只认 4 值）
import { STATES } from '../v3-guard/lib/appendix-rows.mjs'
// W74：正向校验与反向校验必须读**同一份**执行计划，否则两张清单会各自漂移
import { executionPlan } from '../v3-guard/run-all.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const APPENDIX = path.join(
  ROOT,
  'docs/根基文档/审查体系专项/附录-指标固化状态与迁移路线图.md'
)
export const EVIDENCE = path.join(ROOT, 'tools/metrics/evidence.json')

/** §4 汇总表的列下标：cells[1]=专项 cells[2]=覆盖域 cells[3]=总数，其后 A/B/A-/C/D/退役 */
const SUMMARY_COLS = { A: 4, B: 5, 'A-': 6, C: 7, D: 8, 退役: 9 }

/**
 * 读证据映射并校验 ref 活性；返回 { "专项1:2.4": {kind,refs,by} } 形态（过滤非指标键）。
 *
 * W74 起 refs 是数组（一条指标可由多个守卫共同固化）。旧单值 ref 仍被接受并归一成
 * 单元素数组——本仓历史上只有两条登记，归一成本低于改历史。
 *
 * **反向校验也收在这里**（而不是散在 main()）：守卫在跑却没登记它固化哪条指标 ⇒ 那条指标
 * 永远是 C 占位，而「没有登记的固化不算固化」。修前只有正向（登记了但守卫没了），
 * 于是 29 个执行体只登记 2 条、401/403 条停在 C 级，`metrics:derive` 一路 exit 0。
 * 收进本函数是为了让它能被合成映射测到——散在 main() 时，当前仓库恰好没有未登记守卫，
 * 把整段删掉仍全绿（W74 变异 M1 实测），判据等于不存在。
 *
 * @param raw 合成映射（测试用）；缺省读 evidence.json
 */
export function loadEvidence(raw = null) {
  const json = raw ?? JSON.parse(fs.readFileSync(EVIDENCE, 'utf8'))
  const planned = executionPlan()
  const plannedSet = new Set(planned)
  const map = {}
  for (const [id, ev] of Object.entries(json)) {
    if (!/^专项\d+:\d+\.\d+′?$/.test(id)) continue // note 等说明键跳过；键须全限定（专项N:x.y）
    const refs = Array.isArray(ev.refs) ? ev.refs : ev.ref ? [ev.ref] : []
    if (!refs.length) throw new Error(`证据映射 ${id} 没有 refs（要么登记执行体，要么删掉这条）`)
    if (!ev.by) throw new Error(`证据映射 ${id} 缺 by（登记必须写明依据，否则无法复核归属）`)
    for (const ref of refs) {
      if (!fs.existsSync(path.join(ROOT, ref))) {
        throw new Error(`证据映射 ${id} 的 ref 不存在：${ref}`)
      }
      if (ev.kind === 'guard' && !plannedSet.has(path.basename(ref).replace(/\.mjs$/, ''))) {
        throw new Error(`证据映射 ${id} 的守卫未被 run-all 登记：${ref}`)
      }
    }
    map[id] = { ...ev, refs }
  }
  const missing = unregisteredGuards(planned, map)
  if (missing.length) {
    throw new Error(
      `${missing.length} 个执行体没有登记固化的指标编号` +
        `（没有登记的固化不算固化；每条守卫都必须在 evidence.json 里指出它守的是哪条指标）：` +
        missing.join(', ')
    )
  }
  return map
}

/**
 * 反向校验：run-all 执行计划里的每个守卫都必须在本表登记它固化的指标。
 *
 * 治的失效（W74 / 专项5 指标 9.5 家族）：derived 侧此前只有「登记了但守卫没了」一条路径，
 * 「守卫在跑、却没人登记它固化哪条指标」静默通过——29 个执行体只登记 2 条，
 * 附录 401/403 条停在 C 级占位，而 `metrics:derive` 一路 exit 0。
 *
 * @param guardNames run-all 执行计划（GUARDS + SEPARATELY_RUN）
 * @param map        loadEvidence() 的返回值
 * @returns [未登记执行体名]
 */
export function unregisteredGuards(guardNames, map) {
  const registered = new Set()
  for (const ev of Object.values(map)) {
    for (const ref of ev.refs) registered.add(path.basename(ref).replace(/\.mjs$/, ''))
  }
  return guardNames.filter((g) => !registered.has(g))
}

/** 派生单条状态（纯函数，便于测）。
 *  F-01（2026-10-05）：值域与 `lib/appendix-rows.mjs` 的 STATES 六值对齐——
 *  A-/D 此前没有登记通道（derive 只可能返回 A/B/C/退役）⇒ 合法登记被解析器丢弃、
 *  报错还误指「表格结构漂移」。现补两种 kind 的派生路径。 */
export function deriveStatus(ev) {
  if (!ev) return 'C'
  if (ev.kind === 'guard') return 'A'
  if (ev.kind === 'test') return 'B'
  if (ev.kind === 'retired') return '退役'
  if (ev.kind === 'pending-activation') return 'A-'
  if (ev.kind === 'resident') return 'D'
  return 'C'
}

/** 附录状态值域唯一口径：与 lib/appendix-rows.mjs 同源（F-01：此前本文件自带第二套正则） */
const STATE_RE = STATES.map((s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|')
const ROW_RE = new RegExp(
  `^\\|\\s*(\\d+\\.\\d+′?)\\s*\\|[^|]*\\|\\s*(P[0-3])\\s*\\|\\s*(${STATE_RE})\\s*\\|`
)
const ANY_ROW_RE = /^\|\s*(\d+\.\d+′?)\s*\|[^|]*\|\s*(P[0-3])\s*\|\s*([^|]*?)\s*\|/

/**
 * 解析附录 §8：返回 [{name, rows:[{id,risk,status,line}]}]（line 为 1 基行号）。
 * `unparsed`＝形态是数据行但状态值不在值域的行（F-01：与「表格结构漂移」分开报）。
 */
export function parseAppendix(text) {
  const lines = text.split('\n')
  const sections = []
  const unparsed = []
  let cur = null
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^### (专项\d)$/)
    if (h) {
      cur = { name: h[1], rows: [] }
      sections.push(cur)
      continue
    }
    if (cur) {
      const m = lines[i].match(ROW_RE)
      if (m) {
        cur.rows.push({ id: cur.name + ':' + m[1], risk: m[2], status: m[3], line: i + 1 })
        continue
      }
      const any = lines[i].match(ANY_ROW_RE)
      if (any) unparsed.push({ section: cur.name, id: any[1], state: any[3], line: i + 1 })
    }
  }
  return { sections, lines, unparsed }
}

function main() {
  const write = process.argv.includes('--write')
  let map
  try {
    map = loadEvidence()
  } catch (e) {
    // loadEvidence 内含正向（ref 活性）与反向（执行体未登记）两道校验；
    // 落成一行 FAIL 而不是抛栈，读日志的人先看到「哪条指标/哪个守卫」。
    console.error(`[metrics-derive] FAIL：${e.message}`)
    process.exit(1)
  }

  const text = fs.readFileSync(APPENDIX, 'utf8')
  const { sections, lines, unparsed } = parseAppendix(text)
  const total = sections.reduce((a, s) => a + s.rows.length, 0)
  const expected = Object.values(countBySpec()).reduce((a, b) => a + b, 0)
  if (total !== expected) {
    // F-01：把「状态值不在执行体值域」与「表格结构漂移」分开报——
    // 旧文案把 A-/D 这类合法登记一律误指为表格坏了，最省事的保绿动作是删语义。
    if (unparsed.length) {
      console.error(
        `[metrics-derive] FAIL：§8 有 ${unparsed.length} 行状态值不在执行体值域` +
          `（${[...new Set(unparsed.map((u) => u.state))].join('/')}；合法值域=${STATES.join('/')}）` +
          `——先为这些状态定义 evidence kind 或从附录值域删除`
      )
      unparsed
        .slice(0, 5)
        .forEach((u) => console.error(`  - ${u.section} ${u.id} 行${u.line}：${u.state}`))
    } else {
      console.error(
        `[metrics-derive] FAIL：§8 解析到 ${total} 条 ≠ 专项正文 ${expected} 条（表格结构漂移，先修表再派生）`
      )
    }
    process.exit(1)
  }

  const drift = []
  const derived = new Map()
  for (const s of sections) {
    for (const r of s.rows) {
      const d = deriveStatus(map[r.id])
      derived.set(r.id, d)
      if (d !== r.status) drift.push(`${s.name} ${r.id}: ${r.status} → ${d}`)
    }
  }

  if (!write) {
    if (drift.length) {
      console.error(
        `[metrics-derive] FAIL：${drift.length} 条状态与证据派生不一致（状态列只许经 --write 生成）`
      )
      drift.slice(0, 10).forEach((d) => console.error('  - ' + d))
      process.exit(1)
    }
    const counts = {}
    for (const d of derived.values()) counts[d] = (counts[d] ?? 0) + 1
    console.log(
      `[metrics-derive] OK：${total} 条状态与证据映射一致（` +
        Object.entries(counts)
          .map(([k, v]) => `${k}=${v}`)
          .join(' / ') +
        `；证据映射 ${Object.keys(map).length} 条）`
    )
    return
  }

  // --write：① §8 逐行替换状态列（cells[4]）；② §4 重算计数
  const out = lines.slice()
  for (const s of sections) {
    for (const r of s.rows) {
      const cells = out[r.line - 1].split('|')
      cells[4] = ` ${derived.get(r.id)} `
      out[r.line - 1] = cells.join('|')
    }
  }
  for (let i = 0; i < out.length; i++) {
    const h = out[i].match(/^\|\s*(专项\d)\s*\|/)
    if (!h) continue
    const sec = sections.find((x) => x.name === h[1])
    if (!sec) continue
    const cells = out[i].split('|')
    if (cells.length < 11 || !/^\s*\d+\s*$/.test(cells[3] ?? '')) continue // 只动数据行，不动表头
    const cnt = { A: 0, B: 0, 'A-': 0, C: 0, D: 0, 退役: 0 }
    for (const r of sec.rows) cnt[derived.get(r.id)]++
    for (const [st, idx] of Object.entries(SUMMARY_COLS)) cells[idx] = ` ${cnt[st]} `
    out[i] = cells.join('|')
  }
  fs.writeFileSync(APPENDIX, out.join('\n'))
  console.log(
    `[metrics-derive] 已按证据映射重写 §8 状态列与 §4 计数（证据 ${Object.keys(map).length} 条）`
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
