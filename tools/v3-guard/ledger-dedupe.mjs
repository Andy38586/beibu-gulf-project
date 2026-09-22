#!/usr/bin/env node
/**
 * ledger-dedupe.mjs — 问题台账编号唯一性 + 统计行对账守卫（z041）。
 *
 * 背景：commit 34e8bf33（09-19）落归档时按「下一个整数」取号未查 open 侧，
 * 致 b018/c023/c024 在两台账同时存在（跨台账三重）。编号规则要求：
 *   ① 两本台账合号连续、编号全局唯一（撞号按首次分配者保留）；
 *   ② 取号必须先查两台账并集的最低空号；
 *   ③ 「真实 open」统计行的分级计数与 ID 清单必须与表体一致。
 * 本守卫把三条变成可复跑断言：重号/跨台账撞号/统计行漂移即红。
 * 断档（并集序号不连续）只报告不拦——历史上回收的号允许空档，
 * 但取号时必须优先填最低空号（报告出来给人看）。
 *
 * 用法：node tools/v3-guard/ledger-dedupe.mjs   # 有重号/撞号/统计漂移 exit 1
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const OPEN_LEDGER = 'docs/待解决问题.md'
const SOLVED_LEDGER = 'docs/已解决问题.md'

/** 台账行：`| p1 | a034-标题<br>`discover:20260922` | 描述 | 记录 |` */
const ROW_RE = /^\|\s*p([0-3])\s*\|/

/** 从一本文本提取全部台账行编号（按出现序，可重复） */
export function parseLedgerIds(text) {
  const ids = []
  for (const line of text.split(/\r?\n/)) {
    if (!ROW_RE.test(line)) continue
    const cells = line.split('|')
    const idCell = cells[2] ?? ''
    const m = idCell.match(/\b([abcdfz])(\d{3})\b/)
    if (m) ids.push(m[1] + m[2])
  }
  return ids
}

/** 按等级分组的行编号 */
export function parseLedgerByLevel(text) {
  const byLevel = { 0: [], 1: [], 2: [], 3: [] }
  for (const line of text.split(/\r?\n/)) {
    const row = ROW_RE.exec(line)
    if (!row) continue
    const cells = line.split('|')
    const m = (cells[2] ?? '').match(/\b([abcdfz])(\d{3})\b/)
    if (m) byLevel[Number(row[1])].push(m[1] + m[2])
  }
  return byLevel
}

/** 展开统计行的 ID 清单（`a034-a036/b018` → ['a034','a035','a036','b018']） */
export function expandIdList(list) {
  const ids = []
  for (const part of list.split('/')) {
    const range = part.trim().match(/^([abcdfz])(\d{3})-([abcdfz])(\d{3})$/)
    if (range) {
      const [, p1, n1, p2, n2] = range
      if (p1 !== p2) throw new Error(`统计行区间跨前缀：${part}`)
      for (let n = Number(n1); n <= Number(n2); n++) {
        ids.push(p1 + String(n).padStart(3, '0'))
      }
      continue
    }
    const one = part.trim().match(/^([abcdfz])(\d{3})$/)
    if (one) ids.push(one[1] + one[2])
  }
  return ids
}

/** 解析「真实 open」统计行：`- **真实 open：63 项**（p0 × 1：d058｜p1 × 23：…｜…）` */
export function parseOpenStats(text) {
  const m = text.match(
    /真实 open：(\d+) 项\*\*（p0 × (\d+)：([^｜|]*)｜p1 × (\d+)：([^｜|]*)｜p2 × (\d+)：([^｜|]*)｜p3 × (\d+)：([^）]*)）/
  )
  if (!m) return null
  const [, total, c0, l0, c1, l1, c2, l2, c3, l3] = m
  return {
    total: Number(total),
    levels: [
      { level: 0, count: Number(c0), ids: expandIdList(l0) },
      { level: 1, count: Number(c1), ids: expandIdList(l1) },
      { level: 2, count: Number(c2), ids: expandIdList(l2) },
      { level: 3, count: Number(c3), ids: expandIdList(l3) },
    ],
  }
}

/**
 * 台账对账：重号 / 跨台账撞号 / 统计行与表体不一致。
 * @returns {{ problems: string[], gaps: string[] }}
 */
export function auditLedgers(openText, solvedText) {
  const problems = []
  const gaps = []

  const openIds = parseLedgerIds(openText)
  const solvedIds = parseLedgerIds(solvedText)

  // ① 台账内重号
  for (const [name, ids] of [
    ['open', openIds],
    ['solved', solvedIds],
  ]) {
    const seen = new Set()
    for (const id of ids) {
      if (seen.has(id)) problems.push(`✗ ${name} 台账编号重号：${id}（同一编号出现多行）`)
      seen.add(id)
    }
  }

  // ② 跨台账撞号（两本台账合号连续，撞号即回归 34e8bf33 事故形态）
  const solvedSet = new Set(solvedIds)
  for (const id of new Set(openIds)) {
    if (solvedSet.has(id)) {
      problems.push(`✗ 跨台账撞号：${id} 同时存在于待解决与已解决（34e8bf33 事故形态）`)
    }
  }

  // ③ 统计行与表体对账（分级计数 + ID 清单 + 总数）
  const stats = parseOpenStats(openText)
  if (!stats) {
    problems.push('✗ 待解决问题.md 缺少「真实 open」统计行（或格式变更，请同步本守卫）')
  } else {
    const byLevel = parseLedgerByLevel(openText)
    if (stats.total !== openIds.length) {
      problems.push(
        `✗ 统计行总数 ${stats.total} 与表体行数 ${openIds.length} 不一致（z041：曾出现 p2×28/p3×9 与表体 p2×27/p3×10 不符）`
      )
    }
    for (const { level, count, ids } of stats.levels) {
      const actual = byLevel[level]
      const actualSet = new Set(actual)
      const statSet = new Set(ids)
      if (count !== actual.length) {
        problems.push(`✗ p${level} 统计行计数 ${count} 与表体 ${actual.length} 不一致`)
      }
      const missing = [...statSet].filter((id) => !actualSet.has(id))
      const extra = [...actualSet].filter((id) => !statSet.has(id))
      if (missing.length) problems.push(`✗ p${level} 统计行有、表体无：${missing.join('、')}`)
      if (extra.length) problems.push(`✗ p${level} 表体有、统计行无：${extra.join('、')}`)
    }
  }

  // ④ 断档仅报告（并集按前缀的序号连续性）——取号规则要求先填最低空号
  const union = new Set([...openIds, ...solvedIds])
  const byPrefix = new Map()
  for (const id of union) {
    const p = id[0]
    if (!byPrefix.has(p)) byPrefix.set(p, [])
    byPrefix.get(p).push(Number(id.slice(1)))
  }
  for (const [p, nums] of [...byPrefix.entries()].sort()) {
    const max = Math.max(...nums)
    const missing = []
    for (let n = 1; n <= max; n++)
      if (!nums.includes(n)) missing.push(p + String(n).padStart(3, '0'))
    if (missing.length) gaps.push(`${p} 段断档：${missing.join('、')}（新号优先填最低空号）`)
  }

  return { problems, gaps }
}

// ---------- main ----------

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const openText = readFileSync(path.join(ROOT, OPEN_LEDGER), 'utf8')
  const solvedText = readFileSync(path.join(ROOT, SOLVED_LEDGER), 'utf8')
  const { problems, gaps } = auditLedgers(openText, solvedText)

  const openCount = parseLedgerIds(openText).length
  const solvedCount = parseLedgerIds(solvedText).length
  console.log(
    `[ledger-dedupe] 待解决 ${openCount} 项 / 已解决 ${solvedCount} 项，合计 ${openCount + solvedCount} 项`
  )
  for (const g of gaps) console.log(`  ⚠️ ${g}`)
  if (problems.length) {
    console.error('\n' + problems.join('\n'))
    console.error(`\n[ledger-dedupe] 校验未通过（${problems.length} 处）`)
    process.exit(1)
  }
  console.log('[ledger-dedupe] 编号唯一、无跨台账撞号、统计行与表体一致 ✓')
}
