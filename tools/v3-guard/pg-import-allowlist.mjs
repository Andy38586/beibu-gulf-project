/**
 * pg-import-allowlist — `backend/src` 的 `pg` 直引白名单（F100，用户 2026-10-25 裁定 A）。
 *
 * 治的失效：dependency-cruiser 17.4.3 在本仓对裸包名（`pg`/`vue`/`cesium`）一概不解析，
 * `nest-db-access-only-in-repository` 规则从未红过 = 按 §5.4 不存在的假门禁。这里改成
 * 文本级静态扫描：输入受版本控制、可单测、可红样，不依赖模块解析器。
 *
 * 白名单（每条都说明为何它需要直引 pg）：
 *   · infra/db/**            —— 连接池/事务基础设施，pg 的唯一运行时持有面
 *   · modules/<域>/repositories/** —— 仓储层：SQL 与事务边界的唯一业务落点
 * 其他位置的 pg 直引一律红；新增白名单须附理由（§四-10 由用户裁定）。
 *
 * 边界：只拦静态 `from 'pg'` / `require('pg')`；动态 `import('pg')` 是惰性求值，
 * 不构成模块图 eager 风险（与 cesium 门禁同口径）。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { emptyInputProblem } from './lib/input-set.mjs'
import { walkFiles } from './lib/walk.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BACKEND_SRC = path.join(ROOT, 'backend/src')

/** 相对 backend/src 的白名单前缀（窄口；新增须附理由） */
export const PG_IMPORT_ALLOWLIST = [/^infra\/db\//, /^modules\/[^/]+\/repositories\//]

/** 某路径是否属于允许直引 pg 的面 */
export function isPgImportAllowed(relPath) {
  return PG_IMPORT_ALLOWLIST.some((re) => re.test(relPath))
}

/** 剥行/块注释后，判断该行是否含静态 pg 直引 */
function isPgImportLine(line) {
  return /from\s+['"]pg['"]|require\(\s*['"]pg['"]\s*\)/.test(line)
}

/** 扫描一层源文件：返回违规 `相对路径:行号` 列表（空 = 通过） */
export function scanPgImports(sources) {
  const bad = []
  for (const { relPath, text } of sources) {
    if (isPgImportAllowed(relPath)) continue
    const lines = text.split('\n')
    let inBlockComment = false
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]
      if (inBlockComment) {
        if (line.includes('*/')) {
          line = line.slice(line.indexOf('*/') + 2)
          inBlockComment = false
        } else continue
      }
      if (line.includes('/*')) {
        const before = line.slice(0, line.indexOf('/*'))
        if (!line.includes('*/')) inBlockComment = true
        line = before + (line.includes('*/') ? line.slice(line.indexOf('*/') + 2) : '')
      }
      line = line.split('//')[0]
      if (isPgImportLine(line)) {
        bad.push(`${relPath}:${i + 1}`)
        break
      }
    }
  }
  return bad
}

/** 判据入口（纯函数，便于单测/变异）：空输入集合与违规一次返回 */
export function auditPgImports(sources) {
  const problem = emptyInputProblem(sources.length, {
    what: 'backend/src 源文件',
    hint: 'backend/src 是否存在、扩展名是否仍为 .ts/.mts',
  })
  if (problem) return { problem, bad: [] }
  return { problem: null, bad: scanPgImports(sources) }
}

function main() {
  const files = walkFiles(BACKEND_SRC, {
    match: (name) => /\.(ts|mts)$/.test(name),
    skip: ['__tests__'],
    output: 'sources',
  }).map((f) => ({ relPath: f.path, text: f.text }))

  const { problem, bad } = auditPgImports(files)
  if (problem) {
    console.error(`[pg-import-allowlist] FAIL：${problem}`)
    process.exit(1)
  }
  if (bad.length > 0) {
    console.error(`[pg-import-allowlist] FAIL：${bad.length} 处白名单外的静态 pg 直引`)
    for (const b of bad) {
      console.error(`  - backend/src/${b}（pg 只允许出现在 infra/db 或 modules/<域>/repositories）`)
    }
    process.exit(1)
  }
  console.log(
    `[pg-import-allowlist] OK：${files.length} 个后端源文件，pg 直引均在白名单（${PG_IMPORT_ALLOWLIST.length} 类）`
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
