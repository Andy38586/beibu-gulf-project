#!/usr/bin/env node
/**
 * no-ephemeral.mjs — 防"施工/审查编号"进入源码注释与文档（一次性项目防线）。
 *
 * 原则：生产代码不承载任何"谁都能用的阶段编号"（T6.x / 批次 / 816-专项 / 拍板 等），
 * 历史归台账/日志，新一代注释只写"为什么 + 背景"。
 *
 * 存量策略：
 *  - backend/src：已清零，任何命中直接失败；
 *  - frontend/src：历史专项编号行冻结在 baseline（tools/v3-guard/ephemeral-baseline.txt），
 *    随代码重写逐步清理并从基线移除——只拦"不在基线的命中"（含全部新增）。
 *
 * 用法：
 *  node tools/v3-guard/no-ephemeral.mjs            # 扫描（默认；违规 exit 1）
 *  node tools/v3-guard/no-ephemeral.mjs --gen-baseline   # 重新冻结 frontend 基线（重写清债后调用）
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const NEST_SRC = path.join(ROOT, 'backend/src')
const FRONTEND_SRC = path.join(ROOT, 'frontend/src')
const BASELINE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ephemeral-baseline.txt')

// 命中模式：施工任务编号 / 审查专项 / 批次 / 拍板 / 专项指标引用 / 审查轮次
const PATTERNS = [
  /\bT\d+\.\d+\b/, // T3.6 / T6.3
  /批次\s*[0-9一二三四五六七八九十]/, // 批次1 / 批次9
  /拍板/, // xxx 拍板
  /\b专项\d+\b/, // 专项1 / 专项8
  /\bQ\d+\b/, // Q1 / Q4
  /\bM\d+\b/, // M5 / M11
  /816-\S*/, // 816-专项4 / 816-S7-44
  /\bS\d+-\d+\b/, // S7-19
  /\bb\d{3}\b/, // b034
  /（\d{1,2}\/\d{1,2}）/, // 括号内月/日（8/1）——误报防御：排除（50/15min 等时段写法
]

const EXTENSIONS = new Set(['.ts', '.vue', '.css', '.js', '.md', '.mjs', '.cjs'])

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'coverage', '.vite'].includes(entry.name)) continue
      out.push(...walk(full))
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full)
    }
  }
  return out
}

function scanFile(file, isFrontend, baseline) {
  const rel = path.relative(ROOT, file).replaceAll('\\', '/')
  const hits = []
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, idx) => {
    if (!PATTERNS.some((re) => re.test(line))) return
    const trimmed = line.trim()
    const allowed = baseline.get(rel)?.has(trimmed) || false
    if (isFrontend && allowed) return // 存量冻结（frontend）
    hits.push({ line: idx + 1, text: trimmed })
  })
  return hits
}

function loadBaseline() {
  const map = new Map()
  if (!existsSync(BASELINE)) return map
  for (const raw of readFileSync(BASELINE, 'utf8').split('\n')) {
    const sep = raw.indexOf('::')
    if (sep === -1) continue
    const file = raw.slice(0, sep)
    const content = raw.slice(sep + 2)
    if (!map.has(file)) map.set(file, new Set())
    map.get(file).add(content)
  }
  return map
}

function genBaseline() {
  const map = new Map()
  for (const file of walk(FRONTEND_SRC)) {
    const rel = path.relative(ROOT, file).replaceAll('\\', '/')
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line) => {
      if (PATTERNS.some((re) => re.test(line))) {
        if (!map.has(rel)) map.set(rel, new Set())
        map.get(rel).add(line.trim())
      }
    })
  }
  const out = []
  for (const [file, set] of [...map.entries()].sort()) {
    for (const content of [...set].sort()) out.push(`${file}::${content}`)
  }
  // 生成文件头注释
  out.unshift(
    '# 冻结的前端存量编号行（file::content）。重写清债后：更新源码 → 运行 --gen-baseline 覆盖。'
  )
  process.stdout.write(out.join('\n') + '\n')
}

if (process.argv.includes('--gen-baseline')) {
  genBaseline()
  process.exit(0)
}

const baseline = loadBaseline()
let failed = 0
const report = []
for (const root of [NEST_SRC, FRONTEND_SRC]) {
  const isFrontend = root === FRONTEND_SRC
  for (const file of walk(root)) {
    const rel = path.relative(ROOT, file).replaceAll('\\', '/')
    const hits = scanFile(file, isFrontend, baseline)
    for (const h of hits) {
      failed++
      report.push(`  ${rel}:${h.line}  ${h.text}`)
    }
  }
}

if (failed > 0) {
  console.log(
    `[no-ephemeral] ${failed} 处携带施工/审查编号的代码行（后端为硬命中断言；前端未在基线冻结内）：`
  )
  process.stdout.write(report.join('\n') + '\n')
  console.log('处理：新写法改为纯描述（编号进台账/日志）；前端存量用 --gen-baseline 后随迁移清理。')
  process.exit(1)
}
console.log('[no-ephemeral] OK：无施工/审查编号进入源码')
