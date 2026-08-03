#!/usr/bin/env node
/**
 * strip-arch-notes.cjs — 批量清理审计编号注释前缀（z073 / P0-1）
 *
 * 背景：代码中存在大量 `@arch-note a0xx:` / `// z0xx:` / `// b025 / D-2=A:` /
 * `// [FIXED 016]` 等编号注释（AI/审计驱动开发指纹，面试与维护皆不利）。
 * 本脚本删除「编号前缀」，保留注释正文（正文本身是好注释）。
 *
 * 规则（仅作用于注释行，不碰代码/字符串）：
 *   1. `@arch-note <token>[:：]?` 、`@audit-note <token>[:：]?` 、`[FIXED <n>]` → 删
 *   2. 行首编号前缀（后跟 `:：—` 分隔符）：`a0xx` / `b024/b031(D-1=A)` /
 *      `REQ-2（阶段2）` / `P0-5` / `D-6` / `SEC-013` / `314-003` → 删
 *   3. 编号 + 空格 + 中文正文（如 `D-6 技术债:`、`P0-2 修复:`）→ 只删编号
 *   4. 清理后注释为空 → 删除整行
 *
 * 安全边界：
 *   - 裸数字（`// 401:`、`// 144px`）不删（无字母前缀）
 *   - 行中出现的编号（"见 z045"）不删（仅行首）
 *   - 字符串字面量不触碰（仅注释行）
 *
 * 用法：
 *   node scripts/strip-arch-notes.cjs            # 实跑
 *   node scripts/strip-arch-notes.cjs --dry-run  # 只统计不写
 */
const fs = require('node:fs')
const path = require('node:path')

const DRY_RUN = process.argv.includes('--dry-run')

const ROOTS = ['frontend/src', 'backend']
const SKIP_DIRS = new Set(['node_modules', 'coverage', 'dist', '.venv', '__pycache__', '_probe_archive'])
const EXT = /\.(ts|js|mjs|cjs|vue)$/

function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(f)) walk(p, out)
    } else if (EXT.test(f)) {
      out.push(p)
    }
  }
}

/** 清理单行注释文本（raw 不含 `//` 或 `*` 前缀） */
function cleanComment(raw) {
  let c = raw
  c = c.replace(/^\s*@arch-note\s+\S+\s*[:：]?\s*/, '')
  c = c.replace(/^\s*@audit-note\s+\S+\s*[:：]?\s*/, '')
  c = c.replace(/^\s*\[FIXED\s+[^\]]+\]\s*/, '')
  // 行首编号 + 冒号/破折号分隔符
  c = c.replace(
    /^\s*\(?(?:(?:z|d|c|a|b)\d{3}(?:-\w+)?(?:[/+](?:z|d|c|a|b)\d{3})*(?:\s*\(?\w*-\d+[A-Z]?(?:=[A-Z])?\)?)?|REQ-\d+(?:（[^）]*）)?|P\d-\d{2,}|D-\d+[A-Z]?(?:=[A-Z])?|SEC-\d{3,}|\d{3}-\d{3})\)?\s*[:：—]\s*/,
    ''
  )
  // 编号 + 空格 + 中文正文（无冒号分隔）
  c = c.replace(/^\s*D-\d+[A-Z]?\s+(?=[\u4e00-\u9fa5])/, '')
  c = c.replace(/^\s*P\d-\d{2,}\s+(?=[\u4e00-\u9fa5])/, '')
  c = c.replace(/^\s*(?:z|d|c|a|b)\d{3}\s+(?=[\u4e00-\u9fa5])/, '')
  return c
}

/** 清理行尾注释（`code // a032: 正文` → `code // 正文`） */
const INLINE_NOTE_RE =
  /(\/\/\s*)(?:@arch-note\s+\S+\s*[:：]?\s*|@audit-note\s+\S+\s*[:：]?\s*|\[FIXED\s+[^\]]+\]\s*|\(?(?:(?:z|d|c|a|b)\d{3}(?:-\w+)?(?:[/+](?:z|d|c|a|b)\d{3})*(?:\s*\(?\w*-\d+[A-Z]?(?:=[A-Z])?\)?)?|REQ-\d+(?:（[^）]*）)?|P\d-\d{2,}|D-\d+[A-Z]?(?:=[A-Z])?|SEC-\d{3,}|\d{3}-\d{3})\)?\s*[:：—]\s*)/g

function processLine(line) {
  const t = line.trim()
  if (t.startsWith('//')) {
    const idx = line.indexOf('//')
    const cleaned = cleanComment(line.slice(idx + 2))
    if (cleaned.trim() === '') return null
    return line.slice(0, idx) + '// ' + cleaned.trimStart()
  }
  if (t.startsWith('*') && !t.startsWith('*/')) {
    const idx = line.indexOf('*')
    const cleaned = cleanComment(line.slice(idx + 1))
    if (cleaned.trim() === '') return null
    return line.slice(0, idx) + '* ' + cleaned.trimStart()
  }
  // 行尾注释：仅当 `//` 后紧跟编号标记时才替换（URL 的 `//` 后是主机名，不会命中）
  if (INLINE_NOTE_RE.test(line)) {
    return line.replace(INLINE_NOTE_RE, '$1')
  }
  return line
}

const files = []
ROOTS.forEach((r) => walk(r, files))

let totalChangedLines = 0
let changedFiles = 0
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  const lines = src.split('\n')
  const out = []
  let changed = 0
  for (const line of lines) {
    const next = processLine(line)
    if (next === null) {
      changed++
      continue
    }
    if (next !== line) changed++
    out.push(next)
  }
  if (changed > 0) {
    changedFiles++
    totalChangedLines += changed
    if (!DRY_RUN) {
      fs.writeFileSync(file, out.join('\n'), 'utf8')
    }
    console.log(`${DRY_RUN ? '[dry-run]' : '[written]'} ${file.replace(/\\/g, '/')}  ${changed} 行`)
  }
}
console.log(`\n${DRY_RUN ? 'dry-run' : 'done'}: ${changedFiles} 个文件, ${totalChangedLines} 行注释`)
