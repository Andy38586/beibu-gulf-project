#!/usr/bin/env node
/**
 * viewport-tier-single-source.mjs — 断点判定单一来源守卫（G4 收口）。
 *
 * 治什么：960/640 三档断点曾有四份判定实现（useGCS 的 showPanels/navCompact、
 * layoutEngine.layoutModeFor、core/useViewportTier 的第二套 resize+computed、
 * useSliderFocus 的裸比较），共享常量但共享不了时序（useGCS 有 150ms 防抖、
 * useViewportTier 没有 ⇒ 边界瞬态两套判定可分叉），且 `03 §三.1`「断点判定只在
 * useGCS」的字面承诺不再为真。
 *
 * 判据：断点比较只允许出现在 `shared/layout/config.ts` 的 `layoutTierFor`（唯一实现）；
 * 其余 frontend/src 出现 `<|<=|>|>=` × `LAYOUT_DESKTOP_MIN|LAYOUT_DRAWER_MIN` 即红。
 * 消费侧正确姿势：`layoutTierFor(width)`（纯函数）或 `useGCS().tier`
 * （响应式入口，含防抖），`layoutModeFor` 是前者的同义导出。
 *
 * 判据输入 = **索引**（`git grep --cached`），不读工作树脏件（AGENTS §5.4）。
 * 测试文件与注释行放过（解释性文字不该被自己判违规）。
 *
 * 用法：node tools/v3-guard/viewport-tier-single-source.mjs   （违例 exit 1）
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 唯一实现处（唯一定义与比较处） */
export const ALLOWED_FILES = ['frontend/src/shared/layout/config.ts']

/** 违规模式：对断点常量的比较（>= / > / <= / < 任意方向都算再判定） */
export const BREAKPOINT_RE = /(?:>=|<=|<|>)\s*LAYOUT_(?:DESKTOP|DRAWER)_MIN/

/** git grep 的粗筛（POSIX ERE，比 JS 正则宽一点即可） */
const GREP_E = '[<>=]+[[:space:]]*LAYOUT_(DESKTOP|DRAWER)_MIN'

/** 注释行（含 .vue 模板注释）：放过——否则收口说明会被自己判违规 */
const COMMENT = /^\s*(\/\/|\*|\/\*|<!--)/

/**
 * 审计：返回问题列表（空 = 通过）。纯函数，便于单测与变异复验。
 * @param {Array<{relPath: string, text: string}>} files
 * @param {{allowedFiles?: string[]}} [opts]
 */
export function auditViewportTier(files, { allowedFiles = ALLOWED_FILES } = {}) {
  const problems = []
  for (const { relPath, text } of files) {
    if (allowedFiles.includes(relPath)) continue
    if (/__tests__|\.test\.|\.spec\./.test(relPath)) continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (COMMENT.test(line)) continue
      const hit = line.match(BREAKPOINT_RE)
      if (hit) {
        problems.push(
          `${relPath}:${i + 1} 断点再判定（${hit[0].trim()}）—— 唯一实现 ` +
            'shared/layout/config.layoutTierFor；响应式消费 useGCS().tier'
        )
      }
    }
  }
  return problems
}

/**
 * 收集候选源文件：从**索引**里取命中粗筛的 `frontend/src` 文件，再读索引内容行级过滤。
 * 无命中 ⇒ 空数组（零个 git show 调用）。
 */
export function collectCandidates() {
  let listing = ''
  try {
    listing = execFileSync(
      'git',
      ['grep', '--cached', '-l', '-E', '-e', GREP_E, '--', 'frontend/src'],
      { cwd: ROOT, encoding: 'utf8' }
    )
  } catch {
    return [] // git grep 无命中时 exit 1
  }
  const out = []
  for (const rel of listing.split(/\r?\n/)) {
    const relPath = rel.trim()
    if (!relPath || !/\.(ts|vue)$/.test(relPath)) continue
    let text
    try {
      text = execFileSync('git', ['show', `:${relPath}`], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      })
    } catch {
      continue // 索引不可解析（如冲突态）⇒ 不虚报
    }
    out.push({ relPath, text })
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

function main() {
  const files = collectCandidates()
  const problems = auditViewportTier(files)
  console.log(
    `[viewport-tier-single-source] 索引候选 ${files.length} 个源文件（唯一实现处 ${ALLOWED_FILES.join('、')}）`
  )
  if (problems.length === 0) {
    console.log('[viewport-tier-single-source] OK：断点判定无第二实现')
    return
  }
  console.error(`[viewport-tier-single-source] FAIL：${problems.length} 处断点再判定`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
