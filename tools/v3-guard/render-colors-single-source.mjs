#!/usr/bin/env node
/**
 * render-colors-single-source.mjs — 渲染色单一来源守卫（G3 收口）。
 *
 * 治什么：canvas/WebGL 渲染色不能走 CSS 变量，集中在
 * `frontend/src/shared/constants/colors.ts`；但同一 hex 仍会在业务/组件层被手抄成
 * 第二、第三份副本（实测：`#8a93a6` 三副本、`#3b82f6` 跨 core/business 两处），
 * 而 stylelint 的 color-no-hex 只进 CSS/样式块、不扫 .ts/script 段 ⇒ 漂移无信号。
 *
 * 判据域：`frontend/src` 的 .ts/.vue 里，哨兵渲染色只允许出现在
 * `shared/constants/colors.ts`（唯一定义处）；测试夹具与注释行放过。
 * 哨兵 = 曾出过副本的渲染色（G3 三色）；新渲染色入表时必须同时进本清单，
 * 否则 "改了单一来源、副本留在别处" 仍会静默通过。
 *
 * 判据输入 = **索引**（`git grep --cached`），不读工作树脏件（AGENTS §5.4）：
 * 同树多会话在飞时，他窗未暂存的文件不属于本笔判据面；一旦把副本暂存/入库，
 * 本守卫在对应提交的 pre-commit 就会红。
 *
 * 用法：node tools/v3-guard/render-colors-single-source.mjs   （违例 exit 1）
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 单一来源文件（唯一定义处） */
export const ALLOWED_FILES = ['frontend/src/shared/constants/colors.ts']

/** 哨兵渲染色（G3 实测有副本的三色；新增渲染色收口时同步进表） */
export const SENTINEL_COLORS = ['#8a93a6', '#3b82f6', '#f59e0b']

/** 注释行（含 .vue 模板注释）：放过——否则收口说明会被自己判违规 */
const COMMENT = /^\s*(\/\/|\*|\/\*|<!--)/

/**
 * 审计：返回问题列表（空 = 通过）。纯函数，便于单测与变异复验。
 * @param {Array<{relPath: string, text: string}>} files
 * @param {{allowedFiles?: string[], sentinels?: string[]}} [opts]
 */
export function auditRenderColors(
  files,
  { allowedFiles = ALLOWED_FILES, sentinels = SENTINEL_COLORS } = {}
) {
  const problems = []
  for (const { relPath, text } of files) {
    if (allowedFiles.includes(relPath)) continue
    if (/__tests__|\.test\.|\.spec\./.test(relPath)) continue
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (COMMENT.test(line)) continue
      for (const color of sentinels) {
        // 后随 hex 字符不算命中（#8a93a611 八位色是另一个值）
        if (new RegExp(`${color}(?![0-9a-fA-F])`, 'i').test(line)) {
          problems.push(
            `${relPath}:${i + 1} 渲染色手抄 ${color} —— 单一来源 frontend/src/shared/constants/colors.ts`
          )
        }
      }
    }
  }
  return problems
}

/**
 * 收集候选源文件：从**索引**里取命中任一哨兵色的 `frontend/src` 文件
 * （git grep --cached 一次调用；再逐个读索引内容做行级过滤）。
 * 索引无命中 ⇒ 空数组（零个 git show 调用）。
 */
export function collectCandidates({ sentinels = SENTINEL_COLORS } = {}) {
  const args = ['grep', '--cached', '-l', '-i']
  for (const c of sentinels) args.push('-e', c)
  args.push('--', 'frontend/src')
  let listing = ''
  try {
    listing = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
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
  const problems = auditRenderColors(files)
  console.log(
    `[render-colors-single-source] 索引候选 ${files.length} 个源文件（哨兵 ${SENTINEL_COLORS.length} 色，允许定义处 ${ALLOWED_FILES.join('、')}）`
  )
  if (problems.length === 0) {
    console.log('[render-colors-single-source] OK：哨兵渲染色无手抄副本')
    return
  }
  console.error(`[render-colors-single-source] FAIL：${problems.length} 处手抄副本`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
