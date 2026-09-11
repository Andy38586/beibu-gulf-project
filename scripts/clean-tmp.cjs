#!/usr/bin/env node
/**
 * clean-tmp.cjs — 清空 .local/tmp（临时文件唯一落点），可选同时清空 .local/trash。
 *
 * 只清内容、保留目录本身，避免出现"目录消失后脚本又往里写"的竞态。
 *
 * 用法：
 *   node scripts/clean-tmp.cjs               # 清空 .local/tmp
 *   node scripts/clean-tmp.cjs --trash       # 额外清空 .local/trash
 *   node scripts/clean-tmp.cjs --dry-run     # 只列出将被删除的条目
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const TARGETS = ['.local/tmp']
const argv = process.argv.slice(2)

if (argv.includes('--trash')) TARGETS.push('.local/trash')
const dryRun = argv.includes('--dry-run')

let removed = 0
for (const rel of TARGETS) {
  const dir = path.join(ROOT, rel)
  if (!fs.existsSync(dir)) {
    console.log(`skip ${rel}/（不存在）`)
    continue
  }
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (dryRun) {
      console.log(`[dry-run] ${rel}/${name}`)
    } else {
      fs.rmSync(full, { recursive: true, force: true })
    }
    removed++
  }
}

console.log(
  dryRun
    ? `[clean-tmp] ${removed} 个条目待删除（未执行）`
    : `[clean-tmp] 已清理 ${removed} 个条目（目录保留）`
)
