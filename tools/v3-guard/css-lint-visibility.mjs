#!/usr/bin/env node
/**
 * css-lint-visibility.mjs — 纯 CSS 必须对 stylelint「可见」守卫。
 *
 * 为什么需要：`.stylelintrc.json` 曾把 `customSyntax: postcss-html` 的 overrides 写成
 * 覆盖纯 .css（本意是给 .vue 里的 style 块用）⇒ stylelint 拿 HTML 解析器去读纯 CSS，
 * 解析失败即静默跳过 ⇒ `frontend/src/style.css` 的违例长期不可见（2026-09-23 把 overrides
 * 收窄到 .vue 后，同一文件当场冒出 4 处 `custom-property-empty-line-before`）。
 * 危险的不是那 4 处，是"改配置让检查消失"这条路：把 overrides 改宽回去，红就变绿且不留痕。
 *
 * 本守卫钉三件事：
 *   1. 跑 stylelint 的目标 glob 必须覆盖 `*.css`（否则纯 CSS 又没人查）；
 *   2. 根级 `customSyntax` 不得存在（它作用于全部文件，而 .vue 与纯 .css 需要不同
 *      解析器，根级只能设一个 ⇒ 必有一类被读坏）；
 *   3. 带 `customSyntax` 的 overrides，其 `files` 不得能匹配纯 `.css`（只能给 .vue
 *      这类容器用）。「能匹配纯 .css」按 glob 里是否出现独立的 css 词判断，因此把 css
 *      与 vue 写进同一个花括号展开的混合 glob 也算违例——旧判据只认字面 `.css`，可被绕过。
 *
 * 用法：node tools/v3-guard/css-lint-visibility.mjs    （违例 exit 1）
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const CONFIG_FILE = '.stylelintrc.json'
export const PKG_FILE = 'package.json'

/**
 * 纯函数便于单测：配置文本 + lint 命令 → 问题列表（空数组 = 通过）
 * @param {string} configText .stylelintrc.json 文本
 * @param {string} lintCommand package.json 里的 stylelint 脚本命令
 * @returns {string[]}
 */
export function auditCssLintVisibility(configText, lintCommand) {
  const problems = []

  // 1. 目标 glob 必须覆盖纯 CSS（脚本里可能写成 `{css,vue}` 花括号展开，故只认 css 字样）
  if (!/css/.test(lintCommand)) {
    problems.push(`✗ stylelint 脚本未覆盖纯 CSS（现为 \`${lintCommand}\`）：纯 CSS 会脱离检查面`)
  }

  // 2. 带 customSyntax 的 overrides 不得套在纯 .css 上
  let config
  try {
    config = JSON.parse(configText)
  } catch (err) {
    return [`✗ ${CONFIG_FILE} 不是合法 JSON（${err.message}）`]
  }

  // 2. 根级 customSyntax 作用于全部文件：项目同时有 .vue（需 postcss-html）与纯 .css
  //    （需 postcss），根级只能设一个 ⇒ 必有一类被容器解析器读坏后静默跳过。
  //    旧判据只遍历 overrides，把它提到根级就整条空跑。
  if (config.customSyntax) {
    problems.push(
      `✗ 根级 customSyntax=${config.customSyntax} 会作用于全部文件：.vue 需 postcss-html、` +
        `纯 .css 需 postcss，根级只能设一个 ⇒ 必有一类被读坏而静默跳过（违例不可见）。` +
        `customSyntax 只应写在 overrides 里并按文件类型收窄。`
    )
  }

  for (const [i, override] of (config.overrides ?? []).entries()) {
    if (!override.customSyntax) continue
    const files = Array.isArray(override.files) ? override.files : [override.files]
    for (const glob of files) {
      // 「能匹配纯 .css」= glob 里出现独立的 css 词。`{css,vue}` 花括号展开同样能吃到
      // 纯 css，旧判据只认字面 `.css`，于是这种写法可以绕过去。
      if (!/(^|[^a-z0-9])css([^a-z0-9]|$)/i.test(glob)) continue
      problems.push(
        `✗ overrides[${i}] 把 customSyntax=${override.customSyntax} 套在 \`${glob}\` 上：` +
          `纯 CSS 会被容器解析器读坏并静默跳过（违例不可见）`
      )
    }
  }

  return problems
}

function main() {
  const configText = readFileSync(path.join(ROOT, CONFIG_FILE), 'utf8')
  const pkg = JSON.parse(readFileSync(path.join(ROOT, PKG_FILE), 'utf8'))
  const problems = auditCssLintVisibility(configText, pkg.scripts?.stylelint ?? '')
  if (problems.length > 0) {
    console.error('[css-lint-visibility] 未通过：')
    for (const p of problems) console.error('  ' + p)
    process.exit(1)
  }
  console.log('[css-lint-visibility] OK：纯 CSS 在 stylelint 检查面内且未被容器语法覆盖 ✓')
}

if (process.argv[1] && process.argv[1].endsWith('css-lint-visibility.mjs')) main()
