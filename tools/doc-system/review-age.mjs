#!/usr/bin/env node
/**
 * review-age — 契约层「最近复核」超期提醒（只提醒，不判红；心跳用）。
 *
 * 为什么只提醒不判红：契约过期不是违约，是"该有人再看一眼"的信号。
 * 把它做成红会逼人改日期凑绿（判据名实不符，F10），所以本工具恒 exit 0，
 * 只把超期清单打到 stdout；**阈值只在本文件出现一次**（文档不得复述数字）。
 *
 * 用法：node tools/doc-system/review-age.mjs [--days=N] [--json]
 *   --days 缺省 90（超期口径）；到期判据 = 今天 − 最近复核 > days。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DEFAULT_DAYS = 90

export function collectOverdue({
  days = DEFAULT_DAYS,
  today = new Date(),
  readFile = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8'),
} = {}) {
  const map = JSON.parse(readFile('tools/v3-guard/lib/doc-map.json'))
  const out = []
  for (const d of map.docs || []) {
    if (d.layer !== '契约' || d.path.endsWith('/')) continue
    if (!['active', 'frozen'].includes(d.status)) continue
    let text
    try {
      text = readFile(d.path)
    } catch {
      continue
    }
    const m = text.match(/最近复核\*{0,2}\s*[：:]\s*(\d{4}-\d{2}-\d{2})/)
    if (!m) continue
    const gap = Math.floor((today - new Date(`${m[1]}T00:00:00`)) / 86400000)
    if (gap > days) out.push({ id: d.id, path: d.path, reviewed: m[1], days: gap })
  }
  return out.sort((a, b) => b.days - a.days)
}

function main() {
  const arg = process.argv.find((a) => a.startsWith('--days='))
  const days = arg ? Number(arg.split('=')[1]) : DEFAULT_DAYS
  const overdue = collectOverdue({ days })
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ days, overdue }, null, 1))
    return
  }
  if (!overdue.length) {
    console.log(`[review-age] OK：契约层无超期（阈值 ${days} 天）`)
    return
  }
  console.log(`[review-age] ${overdue.length} 份契约超期（>${days} 天，只提醒不判红）：`)
  for (const o of overdue)
    console.log(`  - ${o.id} ${o.path}｜最近复核 ${o.reviewed}｜已 ${o.days} 天`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
