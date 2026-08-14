#!/usr/bin/env node
// S7-26: token 统计脚本——定义数 vs 引用数(死 token 检测), 与专项7 附录 H.5 命令 1 同语义
// 用法: node tools/token-stats.cjs
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.join(process.cwd(), 'frontend/src')
const files = []
const walk = (p) => {
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage', '__tests__'].includes(e.name)) continue
    const f = path.join(p, e.name)
    if (e.isDirectory()) walk(f)
    else if (/\.(vue|css|ts)$/.test(e.name)) files.push(f)
  }
}
walk(SRC)

const text = {}
for (const f of files) text[f] = fs.readFileSync(f, 'utf8')

// 定义: style.css 的 --GCS-* (排除注释行)
const defs = new Map()
for (const f of files) {
  if (!/style\.css$/.test(f)) continue
  text[f].split('\n').forEach((line, i) => {
    if (/^\s*\/\//.test(line) || /^\s*\/\*/.test(line)) return
    const m = line.match(/^\s*(--GCS-[\w-]+)\s*:/)
    if (m) defs.set(m[1], `${path.relative(process.cwd(), f)}:${i + 1}`)
  })
}

// 引用: 全库 var(--GCS-*) 与 JS 字符串引用(排除定义文件与定义行)
const dead = []
const commentOnly = []
for (const [token, defLoc] of defs) {
  let refs = 0
  let realRefs = 0
  let inCommentOnly = false
  for (const [f, t] of Object.entries(text)) {
    const lines = t.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line.includes(token)) continue
      if (f === defLoc.split(':')[0] && line.trim().startsWith(`--${token.slice(3)}`)) continue // 定义行
      refs++
      const isComment = /^\s*(\/\/|\/\*|\*)/.test(line)
      if (!isComment) realRefs++
    }
  }
  if (realRefs === 0) {
    dead.push(token)
    if (refs > 0) commentOnly.push(token)
  }
}

console.log(`token 定义总数: ${defs.size}`)
console.log(`死 token(真实引用 0): ${dead.length}`)
for (const t of dead) {
  const loc = defs.get(t)
  const note = commentOnly.includes(t) ? '(仅注释提及)' : ''
  console.log(`  ${t}  ${loc} ${note}`)
}
const ratio = (dead.length / defs.size) * 100
console.log(`死 token 占比: ${ratio.toFixed(1)}% (阈值 ≤5%)`)
process.exit(ratio > 5 ? 1 : 0)
