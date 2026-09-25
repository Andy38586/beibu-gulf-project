#!/usr/bin/env node
/**
 * 重复表达式扫描器（**只报告，不拦截**）—— S2 转向后「重复消除」维度的判据。
 *
 * ## 为什么是「表达式」而不是「行块」
 *
 * 路线图 §三 把这条判据写成「同构复制块数 / 行数（判据待建）」。但实测推动这次转向的
 * 那处复制（呼吸脉动公式在 OL / Cesium 两渲染器各写一遍）**不是连续行块**：
 *
 *   CesiumRenderer  startBreathing   : const elapsed = (Date.now() - startTime) / 1000
 *                                    : return 10 + Math.sin(elapsed * Math.PI * 2) * 5
 *                                    : const alpha = 0.5 + Math.sin(elapsed * Math.PI * 2) * 0.3
 *   OLRenderer      startBreathing   : const elapsed = (Date.now() - startTime) / 1000
 *                                    : const radius = 10 + Math.sin(elapsed * Math.PI * 2) * 5
 *                                    : const alpha = 0.5 + Math.sin(elapsed * Math.PI * 2) * 0.3
 *
 * 两边第二行一个是 `return`、一个是 `const radius =`，**行级最长公共连续段只有 1 行**；
 * 于是任何 minRun ≥ 3 的"复制块"判据对它全部 0 命中 —— 判据量的和动机不是同一个东西。
 *
 * 真正的重复单位是**公式**：`Math.sin(elapsed * Math.PI * 2)`、`(Date.now() - startTime) / 1000`。
 * 所以本器按**平衡括号组**（形如 `a.b.c(...)` 或裸 `(...)`）抽取表达式片段，
 * 归一化（去空白、按 token 拼接）后按出现次数分组。
 *
 * ## 口径（刻意收窄，避免刷出一片噪声基线）
 *
 * · 只统计出现 **≥2 次**、且 token 数 ≥ `MIN_TOKENS` 的组；
 * · 模板串整段算一个 token（展开 `${}` 会把表达式切碎，反而制造假重复）；
 * · 注释、字符串不参与（词法器直接跳过/整段收下）；
 * · **只报告不拦截** —— 与 S0 的死物扫描同一形态：先量化，闸口不由建判据的人上。
 *   落基线后每次跑都会打印「对比基线 ⇒ 上升/下降/持平」，但**不判非零**：
 *   「上涨即红」是门禁口径（误面多大、豁免口在哪），按 AGENTS §四-10 由用户裁定。
 *
 * 用法：node tools/dup/scan.mjs                  # 打印分组 + 对比基线
 *       node tools/dup/scan.mjs --update --note "…"   # 落基线（须带 --note）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BASELINE = path.join(ROOT, 'tools/dup/baseline.json')

/** 扫描面：业务与核心源码，不含测试（测试里重复的 setup 是合理的） */
export const SCAN_DIRS = ['frontend/src', 'backend/src']
const SKIP_DIR = /(__tests__|__mocks__|node_modules|\.local)/
const SKIP_FILE = /\.(test|spec|d)\.(ts|tsx|js|mjs)$/

/**
 * 计入统计的最小 token 数。
 *
 * 取值依据：**用推动这次转向的那个案例当标尺** —— 呼吸脉动公式
 * `Math.sin(elapsed * Math.PI * 2)` 归一化后正好 12 个 token。低于它的片段
 * （`logger.debug(x)`、`renderer.removeLayer(key)`、`if (import.meta.env.DEV)`）
 * 重复多少次都算不上"债"，计进来只会把真信号埋掉（实测 min=6 时 711 组、13 组真问题）。
 *
 * 实测分布（frontend/src + backend/src，231 文件）：
 *   min=6 → 711 组 / 11817 冗余 token；min=12 → 212 组 / 4803；min=30 → 13 组 / 670
 */
export const MIN_TOKENS = 12

const LINE_STARTS = (src) => {
  const starts = [0]
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1)
  return starts
}

const isIdStart = (c) => c !== undefined && /[A-Za-z_$]/.test(c)
const isIdChar = (c) => c !== undefined && /[\w$]/.test(c)

const OPS3 = ['===', '!==', '**=', '...', '<<=', '>>=']
const OPS2 = [
  '=>',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '?.',
  '+=',
  '-=',
  '*=',
  '/=',
  '++',
  '--',
  '**',
]

/**
 * 极简 TS/Vue 词法器。不追求完整语法，只求「同一段代码切出同一串 token」。
 * @returns {Array<{text:string, line:number}>}
 */
export function tokenize(source) {
  const starts = LINE_STARTS(source)
  const lineAt = (idx) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= idx) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
  const tokens = []
  const n = source.length
  let i = 0
  while (i < n) {
    const c = source[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '/' && source[i + 1] === '/') {
      const j = source.indexOf('\n', i)
      i = j === -1 ? n : j
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      const j = source.indexOf('*/', i + 2)
      i = j === -1 ? n : j + 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < n) {
        if (source[j] === '\\') {
          j += 2
          continue
        }
        if (source[j] === c) {
          j++
          break
        }
        j++
      }
      tokens.push({ text: source.slice(i, j), line: lineAt(i) })
      i = j
      continue
    }
    if (isIdStart(c)) {
      let j = i
      while (j < n && isIdChar(source[j])) j++
      tokens.push({ text: source.slice(i, j), line: lineAt(i) })
      i = j
      continue
    }
    if (/[0-9]/.test(c)) {
      let j = i
      while (j < n && /[\w.]/.test(source[j])) j++
      tokens.push({ text: source.slice(i, j), line: lineAt(i) })
      i = j
      continue
    }
    const three = source.slice(i, i + 3)
    const two = source.slice(i, i + 2)
    if (OPS3.includes(three)) {
      tokens.push({ text: three, line: lineAt(i) })
      i += 3
      continue
    }
    if (OPS2.includes(two)) {
      tokens.push({ text: two, line: lineAt(i) })
      i += 2
      continue
    }
    tokens.push({ text: c, line: lineAt(i) })
    i++
  }
  return tokens
}

const CLOSERS = { ')': '(', ']': '[', '}': '{' }

/**
 * 抽平衡括号组，并把前置的成员链收进来（`Math.sin(...)` 而不是裸 `(...)`）。
 * @returns {Array<{start:number, end:number, text:string}>} 闭区间 [start, end]
 */
export function balancedGroups(tokens) {
  const groups = []
  const stack = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].text
    if (t === '(' || t === '[' || t === '{') {
      stack.push(i)
    } else if (CLOSERS[t]) {
      const open = stack.pop()
      if (open === undefined) continue
      // 前置成员链：`a.b.c(` ⇒ 从 c 回退到 a
      let start = open
      while (start - 1 >= 0) {
        const prev = tokens[start - 1].text
        if (isIdStart(prev[0]) && /^[A-Za-z_$][\w$]*$/.test(prev)) {
          start--
        } else if (prev === '.' && start - 2 >= 0) {
          start--
        } else break
      }
      const slice = tokens.slice(start, i + 1)
      groups.push({ start, end: i, text: slice.map((x) => x.text).join(' ') })
    }
  }
  return groups
}

/** 收集源文件（排除测试与临时目录） */
export function collectFiles(dirs = SCAN_DIRS, root = ROOT) {
  const out = []
  const walk = (abs) => {
    let entries
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(abs, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIR.test(e.name)) walk(p)
      } else if (/\.(ts|tsx|vue)$/.test(e.name) && !SKIP_FILE.test(e.name)) {
        out.push(p)
      }
    }
  }
  for (const d of dirs) walk(path.join(root, d))
  return out.sort()
}

/**
 * 判据面 = **代码**，不是样式。
 * `.vue` 只取 `<script>` 块 —— `<style>` 里的 `var(--GCS-color-primary)` 遍地出现，
 * 那是设计系统的用法，不是债；把它计进来会让 810 组里 700 组是样式噪声，
 * 真信号（如 OLRenderer 里 ×2 的 117-token 块）被埋掉。
 */
export function codeOf(source, ext) {
  if (ext !== '.vue') return source
  const out = []
  for (const m of source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) out.push(m[1])
  return out.join('\n')
}

/**
 * 扫描（纯函数，输入已在内存里，便于测试）。
 * @param {Array<{relPath:string, text:string}>} entries 已是**代码面**（.vue 请先过 codeOf）
 */
export function scanTexts(entries, { minTokens = MIN_TOKENS } = {}) {
  const byText = new Map()
  for (const { relPath, text } of entries) {
    for (const g of balancedGroups(tokenize(text))) {
      const tokenCount = g.text.split(' ').length
      if (tokenCount < minTokens) continue
      if (!byText.has(g.text)) byText.set(g.text, [])
      byText.get(g.text).push({ file: relPath, tokenCount })
    }
  }
  const groups = []
  for (const [text, sites] of byText) {
    if (sites.length < 2) continue
    const tokenCount = sites[0].tokenCount
    groups.push({
      text,
      tokenCount,
      count: sites.length,
      files: [...new Set(sites.map((s) => s.file))],
      redundantTokens: (sites.length - 1) * tokenCount,
    })
  }
  groups.sort((a, b) => b.redundantTokens - a.redundantTokens)
  return {
    groups,
    totalGroups: groups.length,
    totalRedundantTokens: groups.reduce((a, g) => a + g.redundantTokens, 0),
  }
}

/**
 * 扫描磁盘上的源文件。
 * 冗余量 = (出现次数 − 1) × token 数，即「这段表达式本该只写一次，多写了几份」。
 */
export function scanDuplication(files = collectFiles(), opts = {}) {
  const entries = files.map((abs) => ({
    relPath: path.relative(ROOT, abs).replace(/\\/g, '/'),
    text: codeOf(fs.readFileSync(abs, 'utf8'), path.extname(abs)),
  }))
  return scanTexts(entries, opts)
}

/**
 * 与基线比对。**只报告，不判非零** —— 上闸（"上涨即红"）属于门禁口径，
 * 由用户裁定，不由建判据的人顺手加上（AGENTS §四-10）。
 * @returns {{groups:number, redundantTokens:number, deltaGroups:number, deltaTokens:number}}
 */
export function compareToBaseline(current, baseline) {
  const g = baseline?.totalGroups ?? null
  const t = baseline?.totalRedundantTokens ?? null
  return {
    groups: current.totalGroups,
    redundantTokens: current.totalRedundantTokens,
    deltaGroups: g === null ? null : current.totalGroups - g,
    deltaTokens: t === null ? null : current.totalRedundantTokens - t,
  }
}

function readBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
  } catch {
    return null
  }
}

function parseArgs(argv) {
  const i = argv.indexOf('--update')
  const n = argv.indexOf('--note')
  return { update: i !== -1, note: n === -1 ? null : argv[n + 1] }
}

function main() {
  const { update, note } = parseArgs(process.argv.slice(2))
  const files = collectFiles()
  const current = scanDuplication(files)
  const { groups, totalGroups, totalRedundantTokens } = current

  console.log(
    `[dup-scan] 扫描 ${files.length} 个源文件（min ${MIN_TOKENS} tok）｜重复表达式组 ${totalGroups} 个｜` +
      `冗余 token ${totalRedundantTokens}`
  )
  for (const g of groups.slice(0, 12)) {
    console.log(`  ×${g.count}  ${g.tokenCount}tok  ${g.text.slice(0, 72)}`)
    console.log(`        ${g.files.slice(0, 4).join('、')}${g.files.length > 4 ? ' …' : ''}`)
  }
  if (groups.length > 12) console.log(`  …（其余 ${groups.length - 12} 组见基线）`)

  const baseline = readBaseline()
  if (baseline) {
    const c = compareToBaseline(current, baseline)
    const sign = (v) => (v > 0 ? `+${v}` : `${v}`)
    const trend = c.deltaTokens > 0 ? '上升' : c.deltaTokens < 0 ? '下降' : '持平'
    console.log(
      `[dup-scan] 对比基线（${baseline.updatedAt}）：组数 ${sign(c.deltaGroups)}、` +
        `冗余 token ${sign(c.deltaTokens)} ⇒ ${trend}（只报告，不上闸）`
    )
  } else {
    console.log('[dup-scan] 尚无基线：跑 `npm run dup:scan -- --update --note "…"` 落一份')
  }

  if (!update) return
  if (!note) {
    console.error('[dup-scan] FAIL：--update 必须带 --note（说明这次数字为什么变）')
    process.exit(1)
  }
  const data = {
    generatedFrom: 'tools/dup/scan.mjs',
    minTokens: MIN_TOKENS,
    totalGroups,
    totalRedundantTokens,
    updatedAt: new Date().toISOString().slice(0, 10),
    note,
    groups: groups.slice(0, 212).map((g) => ({ text: g.text, count: g.count, files: g.files })),
  }
  fs.writeFileSync(BASELINE, JSON.stringify(data, null, 2) + '\n')
  console.log(`[dup-scan] 已写基线：${path.relative(ROOT, BASELINE)}（${totalGroups} 组）`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
