#!/usr/bin/env node
/**
 * audit-kit / extract-window.mjs — 把审查窗口交付件里的 bash 围栏块抽出来落盘。
 *
 * 为什么要有它：窗口件的判据若只写在正文或表格 cell 里，接收方只能「读」和「信」；
 * 抽不出可执行块，该窗的结论就无法被独立复算（923 有 5 份件栽在这）。
 * 抽取是复算的第一步，也是「交付即契约」的第一道判据 —— 抽不出块 = 该窗未交付。
 *
 * 用法：node tools/audit-kit/extract-window.mjs <outDir> <window.md> [more.md ...]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 抽出全部 bash / sh / shell 围栏块（保持原样，含内部换行） */
export function extractBashBlocks(markdown) {
  const blocks = []
  const re = /^```(?:bash|sh|shell)[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm
  for (const m of markdown.matchAll(re)) blocks.push(m[1])
  return blocks
}

/** 该件是否「机器可复算」：至少含一个可执行块 */
export function isMachineRunnable(markdown) {
  return extractBashBlocks(markdown).length > 0
}

/** 抽取并返回每个件的块数；无块的件按未交付计 */
export function extractTo(outDir, files) {
  fs.mkdirSync(outDir, { recursive: true })
  const report = []
  for (const f of files) {
    const md = fs.readFileSync(f, 'utf8')
    const blocks = extractBashBlocks(md)
    const slug = path.basename(f, '.md')
    blocks.forEach((b, i) => fs.writeFileSync(path.join(outDir, `${slug}.s${i + 1}.sh`), b))
    report.push({ file: f, blocks: blocks.length, delivered: blocks.length > 0 })
  }
  return report
}

function main() {
  const [outDir, ...files] = process.argv.slice(2)
  if (!outDir || files.length === 0) {
    console.error('用法: node tools/audit-kit/extract-window.mjs <outDir> <window.md>...')
    process.exit(2)
  }
  const report = extractTo(outDir, files)
  for (const r of report) {
    console.log(`${r.file}  bash 块=${r.blocks}` + (r.delivered ? '' : '  ⚠ 无块 ⇒ 判未交付'))
  }
  const barren = report.filter((r) => !r.delivered)
  console.log(
    `合计 ${report.reduce((n, r) => n + r.blocks, 0)} 块；无块件 ${barren.length} 个 → ${outDir}`
  )
  // 无块的件非零退出：避免「交了个空壳也算交过」
  if (barren.length > 0) process.exit(1)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
