/**
 * 附录 §8 明细表解析器 —— 审查体系「附录侧」编号/名称/等级/状态正则的**唯一**出处。
 *
 * 之前这段正则长在 metrics-tally.mjs 里；metrics-index 也要读附录对账，
 * 复制一份就成了两种口径（同一张表两处解释）。故抽出成 lib，两边 import。
 *
 * F78（2026-10-26）：抽出后仍剩第二套 —— `tools/metrics/derive-status.mjs` 自带一条
 * 行正则（`(\d+\.\d+′?)` / `[^|]*` / `P[0-3]`），与本文件的
 * `([\d.]+)(′?)` / `(.+?)` / `P\d` 并存，同一张表两种解释。现本文件是**唯一**行语法：
 * derive-status 只消费 `parseRow` + `isState`，不再自己拼正则。
 *
 * 状态值域**不写进行正则**：两个消费者对「值域外状态」的处置不同（附录侧丢弃该行、
 * 指标派生侧归入 unparsed 分类报「值域外」），但「这一行是不是数据行」只许有一个口径
 * —— 把值域收窄进正则，正是在造第二套口径（F78 的原形）。
 *
 * 文本可注入：否则只能整体读真实附录，红样喂不进去。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export const APPENDIX = path.join(
  ROOT,
  'docs/根基文档/审查体系专项/附录-指标固化状态与迁移路线图.md'
)
export const STATES = ['A', 'B', 'A-', 'C', 'D', '退役']

/**
 * 值域判定（F78：此前值域被编进两条正则的 alternation，且两条的**拼序不同**——
 * 本文件按长度降序、derive-status 按 STATES 原序，靠回溯才等价）。
 * 改成数组判定后，「`A-` 会不会被 `A` 前缀截胡」这个问题从根上不存在，
 * 加第七个值也不必再考虑拼序。
 */
export function isState(value) {
  return STATES.includes(value)
}

/**
 * 行语法（唯一口径）：`| 编号′? | 名称 | P级 | 状态 | 其余列… |`。
 * 状态列只收到「非空且不含 `|`」，值域判定交给 `isState`（见文件头）。
 */
const ROW_RE = /^\|\s*([\d.]+)(′?)\s*\|\s*(.+?)\s*\|\s*(P\d)\s*\|\s*([^|]*?)\s*\|/

/**
 * 解析一行 → `{ id, name, level, state }`；不是数据行返回 null。
 * `id` 含 `′` 后缀（同一条指标的重开版本），全限定名由调用方拼（专项N:id）。
 */
export function parseRow(line) {
  const m = ROW_RE.exec(line)
  return m ? { id: m[1] + m[2], name: m[3], level: m[4], state: m[5] } : null
}

/** 专项 → [{id,name,level,state}]，只认 `### 专项N` 分节下的四列表行 */
export function parseDetailRows(markdown = readFileSync(APPENDIX, 'utf8')) {
  const rows = new Map()
  let section = null
  for (const l of markdown.split(/\r?\n/)) {
    const h = l.match(/^### 专项(\d)/)
    if (h) {
      section = '专项' + h[1]
      if (!rows.has(section)) rows.set(section, [])
      continue
    }
    const row = parseRow(l)
    // 值域外的状态不算本表的数据行（附录侧的处置；指标派生侧另有 unparsed 分类）
    if (row && section && isState(row.state)) rows.get(section).push(row)
  }
  return rows
}
