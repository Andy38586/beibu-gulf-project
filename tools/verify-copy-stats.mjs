// 核对 问题副本-2026-08-12-专项审查总问题.md 的统计数字(文案 vs 表格)
import fs from 'node:fs'
const t = fs.readFileSync('docs/问题副本-2026-08-12-专项审查总问题.md', 'utf8')
const lines = t.split('\n')

// 表格行统计: 以 | 开头且含 等级列 的表格行
function tableRows(sectionTitle) {
  const si = lines.findIndex((l) => l.includes(sectionTitle))
  if (si === -1) return []
  const rows = []
  for (let i = si + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^## /.test(l)) break
    if (/^\|/.test(l) && !/^\| *---/.test(l) && !/^\| *原编号/.test(l)) rows.push(l)
  }
  return rows
}

const dedup = tableRows('## 一、去重对照')
const merge = tableRows('## 二、并入既有台账')
const newRows = tableRows('## 三、新立案清单')
console.log(`去重表行数(一) = ${dedup.length} | 文案声明 21`)
console.log(`并入表行数(二) = ${merge.length} | 文案声明 2`)
console.log(`新立案表行数(三) = ${newRows.length} | 文案声明 91`)

// 等级分布(按行)
const lv = { P0: 0, P1: 0, P2: 0, P3: 0 }
for (const r of newRows) {
  const m = r.match(/\|\s*(P[0-3])/)
  if (m) lv[m[1]]++
}
console.log(`按行等级分布: P0=${lv.P0} P1=${lv.P1} P2=${lv.P2} P3=${lv.P3} | 文案: P0×2 P1×32 P2×19 P3×38`)

// 按"原编号"拆分计数(如 P1-4/5 算 2, P1-10/11/12 算 3)
let splitCount = 0
const splitLv = { P0: 0, P1: 0, P2: 0, P3: 0 }
for (const r of newRows) {
  const m = r.match(/^\|\s*([\w/.\-]+?)\s*\|\s*(P[0-3])/)
  if (!m) continue
  const ids = m[1].split('/').filter((x) => /[A-Za-z]/.test(x))
  splitCount += ids.length
  splitLv[m[2]] += ids.length
}
console.log(`按原编号拆分: 共 ${splitCount} 条 | P0=${splitLv.P0} P1=${splitLv.P1} P2=${splitLv.P2} P3=${splitLv.P3}`)

// 各专项行数
const secs = {}
let cur = ''
for (const l of lines) {
  const m = l.match(/^### 专项(\d)/)
  if (m) cur = `专项${m[1]}`
  else if (/^### /.test(l)) cur = ''
  if (cur && /^\|/.test(l) && !/^\| *---/.test(l) && !/^\| *原编号/.test(l)) secs[cur] = (secs[cur] ?? 0) + 1
}
console.log('各专项行数:', JSON.stringify(secs), 'Σ=', Object.values(secs).reduce((a, b) => a + b, 0))

// 去重表行明细(看 21 vs 22 的差在哪)
for (const r of dedup) {
  const id = r.match(/^\|\s*([^|]+?)\s*\|/)
  if (id) console.log('  去重行:', id[1].trim())
}
