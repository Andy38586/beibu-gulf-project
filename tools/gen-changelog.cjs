#!/usr/bin/env node
/**
 * gen-changelog.cjs — 从 git log 生成 CHANGELOG.md（零依赖）
 *
 * 背景：仓库此前无 CHANGELOG（台账 z102）。commitlint 已强制 conventional
 * 格式（type: 描述），故直接解析 git log 按日期分组、type 排序即可，
 * 无需引入 conventional-changelog 等重依赖。
 *
 * 用法（package.json）：
 *   "changelog": "node tools/gen-changelog.cjs"
 *
 * 产物 CHANGELOG.md 头部带「自动生成」标记，人工修改会被下次运行覆盖。
 */
const { spawnSync } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const path = require('node:path')

// type 展示名与排序（未识别 type 归入 Other，排最后）
const TYPE_ORDER = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'style',
  'docs',
  'test',
  'build',
  'ci',
  'chore',
]

const repoRoot = path.join(__dirname, '..')

// %H 完整哈希（取前 7 位展示）、%ad 作者日期（--date=short 即 YYYY-MM-DD）、%s 标题
// spawnSync 数组传参，避免 Windows shell 对中文/特殊字符的引号歧义
const res = spawnSync(
  'git',
  ['-C', repoRoot, 'log', '--pretty=format:%H%x09%ad%x09%s', '--date=short'],
  { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
)

if (res.error || res.status !== 0) {
  console.error('git log 执行失败：', res.stderr || res.error)
  process.exit(1)
}

// subject → { type, text }；非 conventional 行（历史遗留）type 归 Other，原文展示
function parseSubject(subject) {
  const m = subject.match(/^([a-zA-Z]+)(?:\([^)]*\))?:\s*(.+)$/)
  if (!m) return { type: 'other', text: subject }
  const type = m[1].toLowerCase()
  return {
    type: TYPE_ORDER.includes(type) ? type : 'other',
    text: m[2],
  }
}

const byDate = new Map()
for (const line of res.stdout.split('\n')) {
  if (!line.trim()) continue
  const [hash, date, subject] = line.split('\t')
  if (!hash || !date || !subject) continue
  if (!byDate.has(date)) byDate.set(date, [])
  byDate.get(date).push({ hash: hash.slice(0, 7), ...parseSubject(subject) })
}

const dates = [...byDate.keys()].sort().reverse()

const out = ['<!-- 由 `npm run changelog` 自动生成，勿手改 -->', '# Changelog', '']
for (const date of dates) {
  out.push(`## ${date}`, '')
  const entries = byDate.get(date)
  // 同日内按 TYPE_ORDER 稳定排序，未识别类型排最后
  entries.sort(
    (a, b) =>
      TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.hash.localeCompare(b.hash)
  )
  for (const e of entries) {
    const label = e.type === 'other' ? '' : `${e.type}: `
    out.push(`- ${label}${e.text} (${e.hash})`)
  }
  out.push('')
}

const target = path.join(repoRoot, 'CHANGELOG.md')
writeFileSync(target, out.join('\n'), 'utf8')
console.log(
  `CHANGELOG.md 已生成：${dates.length} 天、共 ${res.stdout.split('\n').filter(Boolean).length} 条提交`
)
