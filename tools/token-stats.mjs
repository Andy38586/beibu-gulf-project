#!/usr/bin/env node
/**
 * token-stats — 设计 token 治理工具。
 *
 * 背景：03 §三.5 Token 变更 SOP 引用的治理脚本在 tools 收口清理中缺失，SOP 验收门跑不通
 * （Cannot find module），死 token 检出防护实际缺位。本脚本收口该职责：
 *   1. 扫描 frontend/src/style.css 的 :root 与 :root[data-theme='dark'] 两块 --GCS-* 定义；
 *   2. 扫描 frontend/src 全部源码的 var(--GCS-*) 真实引用（仅代码，注释提及视为未消费）；
 *   3. 报告死 token（定义了但零引用）并按 SOP 门禁退出：死 token 占比 > 5% → exit 1；
 *   4. **反向缺口**（X3）：报告「被 var() 引用但从未定义」的 token —— 这类引用在浏览器里
 *      解析为空值，样式静默丢失，而原统计只有"定义 → 引用"一个方向（曾出现 distinct 引用
 *      52 > 定义 49 却在报告里显示"齐全"）。有未定义引用 ⇒ exit 1。
 *
 * 用法：node tools/token-stats.mjs [--json]
 * 返回码：0 = 门禁通过；1 = 死 token 超阈或扫描异常。CI 可直接挂接。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const ROOT = join(process.cwd(), 'frontend', 'src')
const STYLE_FILE = join(ROOT, 'style.css')
const SOURCE_EXTS = new Set(['.vue', '.ts', '.tsx', '.js', '.mjs', '.css', '.scss'])
const DEAD_RATIO_GATE = 0.05 // 03 §三.5 SOP⑤：死 token ≤5%

/** 从 style.css 中提取 token 定义名及其所在主题块（root/dark） */
function collectDefinitions(css) {
  const defs = new Map() // name -> Set<'root'|'dark'>
  const blockRe = /(?::root\s*\{[^}]*\}|:root\[data-theme='dark'\]\s*\{[^}]*\})/g
  for (const block of css.match(blockRe) ?? []) {
    const theme = block.startsWith(':root[data-theme') ? 'dark' : 'root'
    const tokenRe = /--GCS-[A-Za-z0-9-]+\s*:/g
    for (const m of block.match(tokenRe) ?? []) {
      const name = m.replace(/\s*:$/, '')
      if (!defs.has(name)) defs.set(name, new Set())
      defs.get(name).add(theme)
    }
  }
  return defs
}

/** 递归收集 frontend/src 下源码文件（排除 __tests__ 与 *.test.* —— 测试快照引用不计真实消费） */
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'dist') continue
      yield* walk(p)
    } else if (SOURCE_EXTS.has(entry.slice(entry.lastIndexOf('.')))) {
      yield p
    }
  }
}

function collectUsages() {
  /** name -> [{ file, count }] */
  const usages = new Map()
  for (const file of walk(ROOT)) {
    const text = readFileSync(file, 'utf8')
    // 仅 var( 引用算真实消费；注释里出现 --GCS-x 不计（SOP④「仅注释提及视为未消费」）
    // 先剥掉 /* */ 行块注释与 // 行注释再匹配
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    const re = /var\(\s*(--GCS-[A-Za-z0-9-]+)/g
    let m
    while ((m = re.exec(stripped)) !== null) {
      const name = m[1]
      if (!usages.has(name)) usages.set(name, [])
      const list = usages.get(name)
      const last = list[list.length - 1]
      if (last && last.file === file) last.count += 1
      else list.push({ file: file.replace(/\\/g, '/'), count: 1 })
    }
  }
  return usages
}

/**
 * 全量定义名（含**组件内联定义**）：`--GCS-x:` 既可能是 style.css 的全局 token，
 * 也可能是组件运行时写在 style 对象上的本地变量（如 GCSPanel.vue 的
 * `'--GCS-panel-width': ...`，消费处写作 `var(--GCS-panel-width, 320px)`）。
 * 反向缺口只应报「哪里都没定义」的名字，否则会把这类本地变量误报成缺口（假红）。
 */
function collectAllDefinitionNames() {
  const defined = new Set()
  for (const file of walk(ROOT)) {
    const text = readFileSync(file, 'utf8')
    // 三种定义写法都要认（用前瞻取名字，避免把分隔符并进名字）：
    //   CSS 声明 `--GCS-x: v`、JS 对象键 `'--GCS-x': v`、JS 下标赋值 `style['--GCS-x'] = v`
    for (const m of text.matchAll(/--GCS-[A-Za-z0-9-]+(?=['"]?\s*:|['"]\s*\])/g)) {
      defined.add(m[0])
    }
  }
  return defined
}

function main() {
  let css
  try {
    css = readFileSync(STYLE_FILE, 'utf8')
  } catch {
    console.error(`[token-stats] 无法读取 ${STYLE_FILE}，请在仓库根目录运行`)
    process.exit(1)
  }

  const defs = collectDefinitions(css)
  const usages = collectUsages()

  const dead = []
  const darkOnly = []
  for (const [name, themes] of [...defs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const used = usages.has(name)
    if (!used) dead.push(name)
    else if (themes.size === 1 && themes.has('dark')) darkOnly.push(name)
  }

  const total = defs.size
  const usedCount = total - dead.length
  const ratio = total === 0 ? 0 : dead.length / total
  // 反向缺口（X3）：引用集合 − **全量定义集合**（含组件内联定义）。
  // 原实现只算「定义里有多少被引用」，未定义引用一条都不报 ⇒ 名字拼错/引用幽灵 token 时
  // 样式静默失效无人知；同时不能拿全局定义集合作差，否则组件本地变量（GCSPanel 的
  // --GCS-panel-* 共 7 个）会被误报成缺口。
  const allDefs = collectAllDefinitionNames()
  const undefinedRefs = [...usages.keys()].filter((name) => !allDefs.has(name)).sort()

  console.log('=== GCS Design Token 统计 ===')
  console.log(
    `定义总数: ${total}（亮/暗双块齐全 ${total - darkOnly.length - dead.length}，暗色单独定义 ${darkOnly.length}）`
  )
  console.log(`var() 真实引用: ${usedCount}`)
  console.log(`引用但未定义（反向缺口）: ${undefinedRefs.length}`)
  console.log(
    `死 token: ${dead.length}（占比 ${(ratio * 100).toFixed(2)}%，门禁 ≤${DEAD_RATIO_GATE * 100}%）`
  )

  if (undefinedRefs.length > 0) {
    console.error('\n[token-stats] 引用了未定义的 token（var() 解析为空值，样式静默丢失）：')
    for (const name of undefinedRefs) {
      const where = usages.get(name) ?? []
      console.error(
        `  ${name} ← ${where
          .slice(0, 3)
          .map((u) => u.file.replace(/^.*frontend\/src\//, ''))
          .join('、')}${where.length > 3 ? ` 等 ${where.length} 处` : ''}`
      )
    }
  }

  if (dead.length > 0) {
    console.log('\n死 token 清单（零 var() 引用——删除前先跑 S7-45 式双确认）：')
    for (const name of dead) {
      const themes = defs.get(name)
      const tag =
        themes.has('dark') && themes.has('root') ? '' : themes.has('dark') ? ' [仅暗色块]' : ''
      console.log(`  ${name}${tag}`)
    }
  }

  if (process.argv.includes('--json')) {
    console.log(
      '\n' +
        JSON.stringify(
          { total, usedCount, undefinedRefs, deadTokens: dead, darkOnlyTokens: darkOnly, ratio },
          null,
          2
        )
    )
  }

  if (ratio > DEAD_RATIO_GATE) {
    console.error(
      `\n[token-stats] 门禁未通过：死 token 占比 ${(ratio * 100).toFixed(2)}% > 5%（03 §三.5 SOP⑤）`
    )
    process.exit(1)
  }
  if (undefinedRefs.length > 0) {
    console.error(
      `\n[token-stats] 门禁未通过：${undefinedRefs.length} 个 token 被引用但未定义（X3 反向缺口）`
    )
    process.exit(1)
  }
  console.log('\n[token-stats] 门禁通过 ✓')
}

main()
