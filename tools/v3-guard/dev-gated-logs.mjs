#!/usr/bin/env node
/**
 * dev-gated-logs.mjs — 生产可观测不得被 `import.meta.env.DEV` 门控掉（a018 收口）。
 *
 * 治什么：`logger` 的级别策略是**单点**的（`shared/utils/logger.ts`：debug/info 仅 DEV 输出，
 * warn/error 生产保留、不采样——专1-F8 立的单源）。外层的 `if (import.meta.env.DEV) { logger.warn(...) }`
 * 把这个单点策略**又包了一层**：生产里 warn/error 被整段吞掉 —— 加载失败/切换失败/卸载失败
 * 全都不出日志（不变量 5「可观测」的直接违反），而 DEV 下一切正常，所以只在生产静默。
 *
 * 判据：`frontend/src` 下出现 `import.meta.env.DEV` 且其**同行或紧随 3 行内**是
 * `logger.warn(` / `logger.error(` ⇒ 红。`logger.debug` / `logger.info` 不在此列（它们的
 * 级别门控已在 logger 内部单点实现，再包一层只是冗余，不吞生产信号）。
 *
 * 判据输入 = **索引**内容（`git grep --cached -l` + `git show :<path>`，AGENTS §5.4）。
 * 已知漏口（如实写）：包裹关系跨 4 行以上（注释/多行参数插在中间）、或经中间变量间接调用
 * `logger[level](...)` 的形态看不到；`console.*` 不判（有禁 console 的 lint 面）。
 *
 * 用法：node tools/v3-guard/dev-gated-logs.mjs   # 违例 exit 1
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCAN_DIR = 'frontend/src'
const DEV_RE = /import\.meta\.env\.DEV/
const CONSOLE_SIGNAL_RE = /logger\.(?:warn|error)\s*\(/

/**
 * 审计纯函数：`files` = [{path, text}]（索引内容）。
 * @returns {string[]} 问题列表（空 = 通过）
 */
export function auditDevGatedLogs(files, { lookahead = 3 } = {}) {
  const problems = []
  for (const { path: rel, text } of files) {
    const lines = text.split(/\r?\n/)
    lines.forEach((line, i) => {
      if (!DEV_RE.test(line)) return
      const window = lines.slice(i, i + 1 + lookahead).join('\n')
      if (CONSOLE_SIGNAL_RE.test(window)) {
        problems.push(
          `${rel}:${i + 1} 生产 warn/error 被 import.meta.env.DEV 门控 —— ` +
            `logger 自身已按级别门控（debug/info 仅 DEV；warn/error 生产保留，专1-F8 单源），` +
            `外层再包一层 = 生产静默`
        )
      }
    })
  }
  return problems
}

/** 候选文件：索引里含 `import.meta.env.DEV` 的 ts/vue */
export function collectCandidates() {
  let listing = ''
  try {
    listing = execFileSync(
      'git',
      ['grep', '--cached', '-l', '-e', 'import.meta.env.DEV', '--', SCAN_DIR],
      { cwd: ROOT, encoding: 'utf8' }
    )
  } catch {
    return []
  }
  const out = []
  for (const rel of listing.split(/\r?\n/)) {
    const p = rel.trim()
    if (!p || !/\.(ts|vue)$/.test(p)) continue
    try {
      out.push({
        path: p,
        text: execFileSync('git', ['show', `:${p}`], {
          cwd: ROOT,
          encoding: 'utf8',
          maxBuffer: 32 << 20,
        }),
      })
    } catch {
      // 索引读不到：跳过（不假装读过）
    }
  }
  return out
}

function main() {
  const files = collectCandidates()
  const problems = auditDevGatedLogs(files)
  if (problems.length) {
    console.error('[dev-gated-logs] 未通过：生产可观测被 DEV 门控')
    for (const p of problems) console.error('  ✗ ' + p)
    process.exit(1)
  }
  console.log(
    `[dev-gated-logs] OK：${files.length} 份含 import.meta.env.DEV 的文件里没有门控 warn/error ✓`
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
