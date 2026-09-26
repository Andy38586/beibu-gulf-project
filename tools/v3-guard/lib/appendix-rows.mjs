/**
 * 附录 §8 明细表解析器 —— 审查体系「附录侧」编号/名称/等级/状态的正则唯一口径。
 *
 * 之前这段正则长在 metrics-tally.mjs 里；metrics-index 也要读附录对账，
 * 复制一份就成了两种口径（同一张表两处解释）。故抽出成 lib，两边 import。
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
    const m = l.match(/^\|\s*([\d.]+)(′?)\s*\|\s*(.+?)\s*\|\s*(P\d)\s*\|\s*(A-|A|B|C|D|退役)\s*\|/)
    if (m && section) {
      rows.get(section).push({ id: m[1] + m[2], name: m[3], level: m[4], state: m[5] })
    }
  }
  return rows
}
