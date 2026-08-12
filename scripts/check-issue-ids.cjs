#!/usr/bin/env node
/**
 * 问题台账编号查重（check-issue-ids）
 *
 * 用途：扫描 docs/待解决问题.md 与 docs/已解决问题.md 的条目编号，
 * 报告：① 各自文档内部重复；② 跨文档撞号（全局唯一性破坏）。
 *
 * 背景：2026-08-10 台账体检挖出 5 处历史撞号（b025/b029/z045/z042/b046），
 * 根因是"分配编号前未查重"。本脚本作为分配编号前的强制检查：
 *   node scripts/check-issue-ids.cjs
 *
 * 编号规则见 docs/待解决问题.md 头部：a=地图层 b=业务层 c=组件层 d=后端层 z=暂未归类 + 四位数，全局唯一。
 * 注意：只检查「条目行」（表格行首为 | 等级 | 编号-），正文提及不计入。
 */
const fs = require('fs')
const path = require('path')

const OPEN = path.join(__dirname, '..', 'docs', '待解决问题.md')
const CLOSED = path.join(__dirname, '..', 'docs', '已解决问题.md')

function entryIds(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const ids = []
  for (const l of lines) {
    // 支持拆条后缀（如 z050-FE / z050-BE）：后缀视为独立 id，不算重复
    const m = l.match(/^\|\s+p\d+\s+\|\s+([abcdz]\d{3}(?:-[A-Z]+)?)-/)
    if (m) ids.push(m[1])
  }
  return ids
}

function report(name, ids) {
  const seen = new Map()
  for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1)
  const dups = [...seen.entries()].filter(([, n]) => n > 1)
  console.log(
    `[${name}] 条目 ${ids.length} 条` +
      (dups.length
        ? `，内部重复: ${dups.map(([id, n]) => `${id}×${n}`).join(', ')}`
        : '，内部无重复 ✓')
  )
  return dups
}

const open = entryIds(OPEN)
const closed = entryIds(CLOSED)
let fail = 0

fail += report('待解决问题.md', open).length
fail += report('已解决问题.md', closed).length

const openSet = new Set(open)
const collide = [...openSet].filter((id) => new Set(closed).has(id))
if (collide.length) {
  console.log(`✗ 跨文档撞号: ${collide.join(', ')}（待解决与已解决共用编号，违反全局唯一）`)
  fail += collide.length
} else {
  console.log('跨文档撞号: 无 ✓')
}

console.log(fail ? `\n检查未通过（${fail} 处问题）` : '\n检查通过：编号体系全局唯一 ✓')
process.exit(fail ? 1 : 0)
