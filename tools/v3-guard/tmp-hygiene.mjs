#!/usr/bin/env node
/**
 * tmp-hygiene.mjs — 临时文件卫生守卫（第 5 个 v3 守卫）。
 *
 * 背景：调试与 agent 会话会在仓库根目录、docs/、tools/ 等受控目录落下临时文件
 * （.tmp-*、*.bak、~$xxx、一次性截图/脚本）。这些残渣污染目录，且因未入库而无人清理，
 * 每次整理都要重新"考古"。
 *
 * 约定（唯一落点：.local/，见 .local/README.md）：
 *   - 临时文件  → .local/tmp/    （npm run tmp:clean 清空）
 *   - 待删暂存  → .local/trash/
 *   - agent 文档 → .local/agent-docs/
 *
 * 断言：受控目录（下列目录的一级条目）内不得出现临时文件命名模式。
 * 只扫一级是有意为之：源码树内的一级文件本就应是受控资产，深层目录由
 * structure-check.mjs 等其他守卫负责。
 *
 * 用法：
 *   node tools/v3-guard/tmp-hygiene.mjs              # 扫描（违规 exit 1）
 *   node tools/v3-guard/tmp-hygiene.mjs --json       # 机器可读输出
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 受控目录：只检查一级条目 */
const WATCHED = ['.', 'docs', 'tools', 'scripts', 'backend', 'frontend']

/** 临时文件命名模式（命中即违规） */
const TEMP_PATTERNS = [
  { re: /^\.tmp[-_.]/, why: '临时文件前缀 .tmp-' },
  { re: /\.(tmp|bak|orig|swp|swo|old)$/i, why: '临时/备份扩展名' },
  { re: /^~[$~]?/, why: 'Office/WPS 锁文件' },
  { re: /^(scratch|debug-|draft-|try-|temp[-_.])/i, why: '草稿命名前缀' },
  { re: /^(screenshot|截图)[-_.]?.*\.(png|jpe?g|webp)$/i, why: '一次性截图' },
]

/** 合法长驻文件（历史约定，不是残渣） */
const ALLOWED = new Set(['.eslintcache', '.tmp-hygiene.json'])

function scan() {
  const hits = []
  for (const rel of WATCHED) {
    const dir = path.join(ROOT, rel)
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue // 目录不存在（如未安装子项目）则跳过
    }
    for (const e of entries) {
      if (!e.isFile()) continue
      if (ALLOWED.has(e.name)) continue
      const hit = TEMP_PATTERNS.find((p) => p.re.test(e.name))
      if (hit) hits.push({ dir: rel === '.' ? '(仓库根)' : rel + '/', name: e.name, why: hit.why })
    }
  }
  return hits
}

const hits = scan()

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ hits }, null, 2))
  process.exit(hits.length ? 1 : 0)
}

if (hits.length > 0) {
  console.log(`[tmp-hygiene] ${hits.length} 个临时文件残留在受控目录：`)
  for (const h of hits) console.log(`  - ${h.dir}${h.name}（${h.why}）`)
  console.log('处理：移动到 .local/tmp/（待删则 .local/trash/），或 npm run tmp:clean 清理。')
  process.exit(1)
}
console.log(`[tmp-hygiene] OK：${WATCHED.length} 个受控目录无临时文件残留`)
