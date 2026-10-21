// W52（2026-10-20）审件库清单校验：产出「批次/文件数/md5」确定性凭据。
// 用途：审件库不在本仓版本控制内（用户 2026-10-03 口径），本条给 K4 §1 豁免
// 清单提供等价凭据——「审件库仍在、批次没丢、内容没被静默改」可由一条命令复算。
//
// 为何不是 git：桌面独立库有自己的 git（W52-D3），本仓只跑校验、不持有库内容。
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const AUDITS_DIR = process.env.AUDITS_DIR
  ? path.resolve(process.env.AUDITS_DIR)
  : 'C:/Users/JionHappY/Desktop/_北部湾项目/02-审查流水账/audits'

const isBatchDir = (name) =>
  /^\d/.test(name) && fs.statSync(path.join(AUDITS_DIR, name)).isDirectory()
// 顶层里的 md 是「归并映射 / 编号映射 / 总索引」这类批次级文档，也算凭据面
const isTopEvidence = (name) => /^[^.]/.test(name) && /\.(md|txt)$/.test(name)

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

const md5 = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')

function main() {
  if (!fs.existsSync(AUDITS_DIR)) {
    console.error(`[audits-manifest] FAIL：审件库不存在：${AUDITS_DIR}`)
    console.error(
      '  ——路径变了先改 tools/audit-kit/paths.mjs 的默认值或设 AUDITS_DIR，不要在本仓重建副本'
    )
    process.exit(1)
  }

  const entries = fs.readdirSync(AUDITS_DIR, { withFileTypes: true })
  const batches = entries
    .filter((e) => isBatchDir(e.name))
    .map((e) => e.name)
    .sort()
  const topFiles = entries
    .filter((e) => e.isFile() && isTopEvidence(e.name))
    .map((e) => e.name)
    .sort()

  const files = walk(AUDITS_DIR)
  const lines = files
    .map((f) => {
      const rel = path.relative(AUDITS_DIR, f).split(path.sep).join('/')
      return `${md5(f)}  ${rel}`
    })
    .sort((a, b) => a.slice(34).localeCompare(b.slice(34)))

  console.log(`# 审件库清单（批次 ${batches.length} 个 / 文件 ${files.length} 份）`)
  console.log(`# 生成命令：node tools/audit-kit/audits-manifest.cjs`)
  console.log(`# 口径：逐文件 md5，排除 .git；路径相对审件库根，正序`)
  for (const b of batches) console.log(`batch ${b}`)
  for (const f of topFiles) console.log(`top ${f}`)
  for (const l of lines) console.log(l)

  const write = process.argv.includes('--write')
  if (write) {
    const out = path.join(__dirname, 'audits-manifest.txt')
    fs.writeFileSync(out, `${lines.join('\n')}\n`)
    console.log(
      `[audits-manifest] 已写入 ${path.relative(process.cwd(), out)}（${lines.length} 行）`
    )
  } else {
    console.log(`[audits-manifest] OK：批次 ${batches.length} / 文件 ${files.length}`)
  }
}

main()
