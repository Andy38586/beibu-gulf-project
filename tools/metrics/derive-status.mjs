#!/usr/bin/env node
/**
 * 指标账派生器 —— 附录 §8 的固化状态列**由证据映射推导**，不再手填。
 *
 * ## 为什么必须有这条
 *
 * 附录 §8 的 396 条状态是 2026-09-09 重建时的占位值（全 C，原文声明「逐条复核前不得
 * 视为真实固化证据」）——手填 + 整列同值，正是路线图 S3 指标账出口要消灭的两个特征。
 *
 * ## 口径
 *
 *   · 证据映射 `tools/metrics/evidence.json`：指标编号（形如 2.4）→ { kind, ref, by }。
 *     kind=guard ⇒ ref 必须存在**且**被 run-all.mjs 登记 ⇒ 派生 A；
 *     kind=test  ⇒ ref 文件存在 ⇒ 派生 B；
 *     kind=retired ⇒ 派生 退役；
 *     无映射 ⇒ C（占位，诚实表示"暂无固化证据"）。
 *   · ref 文件不存在或 guard 未被 run-all 登记 ⇒ 本器直接红（防止守卫被删后映射仍称固化）。
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const APPENDIX = path.join(
  ROOT,
  'docs/根基文档/审查体系专项/附录-指标固化状态与迁移路线图.md'
)
export const EVIDENCE = path.join(ROOT, 'tools/metrics/evidence.json')
const RUN_ALL = path.join(ROOT, 'tools/v3-guard/run-all.mjs')

/** §4 汇总表的列下标：cells[1]=专项 cells[2]=覆盖域 cells[3]=总数，其后 A/B/A-/C/D/退役 */
const SUMMARY_COLS = { A: 4, B: 5, 'A-': 6, C: 7, D: 8, 退役: 9 }

/** 读证据映射并校验 ref 活性；返回 { "2.4": {kind,ref,by} } 形态（过滤非指标键） */
export function loadEvidence() {
  const raw = JSON.parse(fs.readFileSync(EVIDENCE, 'utf8'))
  const runAllSrc = fs.readFileSync(RUN_ALL, 'utf8')
  const map = {}
  for (const [id, ev] of Object.entries(raw)) {
    if (!/^专项\d+:\d+\.\d+′?$/.test(id)) continue // note 等说明键跳过；键须全限定（专项N:x.y）
    if (!fs.existsSync(path.join(ROOT, ev.ref))) {
      throw new Error(`证据映射 ${id} 的 ref 不存在：${ev.ref}`)
    }
    if (ev.kind === 'guard' && !runAllSrc.includes(path.basename(ev.ref).replace(/\.mjs$/, ''))) {
      throw new Error(`证据映射 ${id} 的守卫未被 run-all 登记：${ev.ref}`)
    }
    map[id] = ev
  }
  return map
}

/** 派生单条状态（纯函数，便于测） */
export function deriveStatus(ev) {
  if (!ev) return 'C'
  if (ev.kind === 'guard') return 'A'
  if (ev.kind === 'test') return 'B'
  if (ev.kind === 'retired') return '退役'
  return 'C'
}

/** 解析附录 §8：返回 [{name, rows:[{id,name,risk,status,line}]}]（line 为 1 基行号） */
export function parseAppendix(text) {
  const lines = text.split('\n')
  const sections = []
  let cur = null
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^### (专项\d)$/)
    if (h) {
      cur = { name: h[1], rows: [] }
      sections.push(cur)
      continue
    }
    if (cur) {
      const m = lines[i].match(
        /^\|\s*(\d+\.\d+′?)\s*\|[^|]*\|\s*(P[0-3])\s*\|\s*([A-C-]|退役)\s*\|/
      )
      if (m) cur.rows.push({ id: cur.name + ':' + m[1], risk: m[2], status: m[3], line: i + 1 })
    }
  }
  return { sections, lines }
}

function main() {
  const write = process.argv.includes('--write')
  const map = loadEvidence()
  const text = fs.readFileSync(APPENDIX, 'utf8')
  const { sections, lines } = parseAppendix(text)
  const total = sections.reduce((a, s) => a + s.rows.length, 0)
  if (total !== 396) {
    console.error(
      `[metrics-derive] FAIL：§8 解析到 ${total} 条 ≠ 396（表格结构漂移，先修表再派生）`
    )
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
      `[metrics-derive] OK：396 条状态与证据映射一致（` +
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
