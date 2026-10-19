#!/usr/bin/env node
/**
 * color-channel-parity.mjs — CSS 通道与 canvas 通道的语义色对账（W67 / 根因 C 的 RC1 族）。
 *
 * ## 治什么
 *
 * 本项目有两条渲染通道，对同一语义色各需一份表示：
 *   · DOM/CSS 通道 → `frontend/src/style.css` 的 `--GCS-color-*`（可读 CSS 变量）
 *   · canvas/WebGL 通道 → `frontend/src/shared/constants/colors.ts` 的 TS 常量
 *     （canvas 读不到 `var(--GCS-*)`，这是物理限制，不是取舍）
 *
 * 两份**必须**存在，但两份的值必须一致。现状是漂的，且漂的方式有代价：
 *
 * ```
 * 语义      CSS(.style.css light)        对比度   TS 侧同语义(洪涝档位)   对比度
 * success   rgb(24 122 48)               5.43    #67C23A               2.24
 * warning   rgb(163 99 0)                4.84    #E6A23C               2.19
 * danger    rgb(204 58 77)               4.91    #F56C6C               2.90
 * ```
 *
 * 即：2026-09-23 为 WCAG AA 把 CSS 侧三色**提深过**，而 canvas 侧没跟上——
 * 「同一语义在 CSS 上达标、在地图/ECharts 上不达标」。
 *
 * ## 口径（本守卫只判「可派生的事实」，不选边权威源）
 *
 * 用户 2026-10-19 裁决 C3：「先加对账守卫（两侧必须成对改，否则红）」。
 * 因此本守卫**不裁定哪一份权威**，只判：
 *
 *   1. **成对性**：`SEMANTIC_PAIRS` 里每一对（CSS 变量名 ↔ TS 常量的 hex 值）
 *      必须同时存在；一侧被删一侧还在 ⇒ 红（说明有人在改一边）。
 *   2. **零散落**：除权威源 `colors.ts` 外，`.ts`/`.vue` 生产代码里不得出现裸 hex 字面量；
 *      确有必要（业务专属色表）必须在 `ALLOWED_HEX_FILES` 里登记并写理由。
 *
 * **不判**「两侧值是否相等」——那会立刻把当前 3 组漂移全红，而修法（把 CSS 的提深值
 * 搬到 TS，或反过来）牵动 WCAG 取舍，属 §四-9 须单独裁决。本守卫先把**能自动判的部分**
 * 立起来，让「新增漂移」不再无声发生；存量 3 组记入待执行清单。
 *
 * ## 为什么不是 stylelint 扩展
 *
 * `.stylelintrc.json` 的 `color-no-hex` 只覆盖 `frontend/src` 下 css/vue 的样式块，
 * `.ts` 文件根本不在它的解析面里（实测：`.ts` 面 69 处裸 hex，stylelint 一处也看不见）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const STYLE_FILE = 'frontend/src/style.css'
/** 渲染色权威源：canvas 通道的唯一具名色表 */
export const COLOR_AUTH = 'frontend/src/shared/constants/colors.ts'

/**
 * 语义色成对表：CSS 变量名 ↔ TS 侧对应常量名。
 *
 * 为什么手写这张表而不是全自动配对：两个通道的命名空间不同（`--GCS-color-success`
 * 在 TS 侧没有同名常量，对应的是洪涝档位的「低风险」）。自动配对只能靠值相等，
 * 而值现在恰恰是不等的——靠值配对会在漂移时**静默脱钩**（找不到对，于是不判）。
 * 表里每条都必须能被两侧同时解析出来，缺一侧即红。
 */
export const SEMANTIC_PAIRS = [
  { css: 'success', ts: '#67C23A', note: '洪涝「低风险」档 FLOOD_RISK_COLORS.stroke' },
  { css: 'warning', ts: '#E6A23C', note: '洪涝「中风险」档 FLOOD_RISK_COLORS.stroke' },
  { css: 'danger', ts: '#F56C6C', note: '洪涝「高风险」档 FLOOD_RISK_COLORS.stroke' },
]

/**
 * 允许出现裸 hex 的 `.ts`/`.vue` 文件（除权威源外）。
 * 每条必须写「为什么它不能引用权威源」。
 */
export const ALLOWED_HEX_FILES = [
  {
    file: 'frontend/src/business/flood-analysis/constants/colors.ts',
    why:
      '洪涝风险档位表：6 档各带带透明度的 fill（rgba 派生自 stroke），' +
      '且档位语义与 FACILITY_COLORS_MAP 不同（风险等级 vs 设施类型）。' +
      '**它是 SEMANTIC_PAIRS 的 TS 侧对账对象，不是豁免**——把它剔出去守卫就无从对账。',
    exemptFromBareHex: true,
  },
  {
    file: 'frontend/src/business/diversion/constants/diversionMap.ts',
    why:
      '分流弧线/运河线位配色：Cesium 弧线渲染需要 Material 用的纯色值，' +
      '与图层语义绑定（我方/对方/高亮三态），shared 无对应具名常量。' +
      '待评估是否并入 colors.ts。',
    exemptFromBareHex: true,
  },
  {
    file: 'frontend/src/visualization/charts/SankeyChart.vue',
    why:
      '**未登记豁免的债务**：`color: dark ? "#e5eaf3" : "#303133"` 与 ' +
      'CHART_COLORS.textPrimary（light #303133 / dark #e8edf4）不等（#e5eaf3 ≠ #e8edf4），' +
      '注释自陈了这个差异却选择保留。登记在此只为让守卫先上线；清理路径见待执行清单 W67。',
    exemptFromBareHex: true,
  },
]

const HEX_LITERAL_RE = /['"`](#[0-9a-fA-F]{3,8})['"`]/g

/** 从 CSS 文本取某语义色的 rgb 三元组 */
export function cssSemanticColor(cssText, name) {
  const m = cssText.match(new RegExp(`--GCS-color-${name}\\s*:\\s*rgb\\(([^)]+)\\)`))
  if (!m) return null
  const parts = m[1]
    .trim()
    .split(/[\s,/]+/)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
  return parts.length >= 3 ? parts.slice(0, 3) : null
}

const hexToRgb = (hex) => {
  const s = hex.replace('#', '')
  const n = s.length === 3 ? [...s].map((c) => c + c).join('') : s.slice(0, 6)
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16))
}

/**
 * 主判定（纯函数，便于测）。
 * @param {object} o
 * @param {string} o.cssText      style.css 内容
 * @param {Map<string,string>} o.sources  文件 → 内容（非测试生产代码）
 */
export function auditColorParity({
  cssText,
  sources,
  pairs = SEMANTIC_PAIRS,
  allowed = ALLOWED_HEX_FILES,
}) {
  const problems = []

  // 1. 成对性：两侧都要能解析出来
  for (const p of pairs) {
    const css = cssSemanticColor(cssText, p.css)
    if (!css) {
      problems.push(
        `--GCS-color-${p.css} 在 ${STYLE_FILE} 里解析不到 —— CSS 通道丢了这一色，` +
          `而 canvas 通道仍有 ${p.ts}（${p.note}）。两侧必须成对存在。`
      )
      continue
    }
    // TS 侧：该 hex 必须仍在某个源码文件里出现（删了说明有人只改一边）
    const hexPresent = [...sources.values()].some((t) =>
      new RegExp(`['"\`]${p.ts}['"\`]`, 'i').test(t)
    )
    if (!hexPresent) {
      problems.push(
        `canvas 通道找不到 ${p.ts}（${p.note}）—— CSS 侧 --GCS-color-${p.css} 仍在，` +
          `TS 侧被删了。两侧必须成对存在（删一侧即红）。`
      )
    }
  }

  // 2. 零散落：权威源之外不许有裸 hex
  const allowedFiles = new Set(allowed.filter((a) => a.exemptFromBareHex).map((a) => a.file))
  // 豁免面不得把判据域盖住：那样裸 hex 判据就扫不到任何东西，等于被禁用
  // （AGENTS §七-7「半覆盖的守卫比没有守卫更危险」的同族形态）
  const scannable = [...sources.keys()].filter((f) => f !== COLOR_AUTH)
  if (scannable.length > 0 && scannable.every((f) => allowedFiles.has(f))) {
    problems.push(
      `豁免面覆盖了判据域全部文件（${scannable.length} 个）——` +
        `裸 hex 判据扫不到任何东西，等于被禁用。豁免清单必须留出可判面。`
    )
  }
  for (const [file, text] of sources) {
    if (file === COLOR_AUTH || allowedFiles.has(file)) continue
    const lines = text.split(/\r?\n/)
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '')
      const m = code.match(HEX_LITERAL_RE)
      if (m) {
        problems.push(
          `${file}:${i + 1} 裸 hex ${m.join(' ')} —— canvas 通道的色值必须来自 ` +
            `${COLOR_AUTH} 的具名常量；确属业务专属色表请在 ALLOWED_HEX_FILES 登记理由。`
        )
      }
    })
  }

  return { problems }
}

/** 对比度（WCAG 相对亮度），供报告与测试用 */
export function contrastOnWhite(rgb) {
  const f = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
  return +(1.05 / (L + 0.05)).toFixed(2)
}

function listSources() {
  const out = []
  const walk = (abs) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.venv'].includes(e.name)) continue
      const p = path.join(abs, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx|vue)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
        const rel = path.relative(ROOT, p).replace(/\\/g, '/')
        if (!/\.(test|spec)\./.test(rel) && !/__tests__/.test(rel)) out.push(rel)
      }
    }
  }
  walk(path.join(ROOT, 'frontend/src'))
  return out.sort()
}

function main() {
  const cssText = fs.readFileSync(path.join(ROOT, STYLE_FILE), 'utf8')
  const sources = new Map()
  for (const f of listSources()) sources.set(f, fs.readFileSync(path.join(ROOT, f), 'utf8'))

  const { problems } = auditColorParity({ cssText, sources })

  console.log(`[color-channel-parity] CSS ${STYLE_FILE} × canvas ${COLOR_AUTH}`)
  for (const p of SEMANTIC_PAIRS) {
    const css = cssSemanticColor(cssText, p.css)
    console.log(
      `  --GCS-color-${p.css.padEnd(8)} ${css ? `rgb(${css.join(' ')}) 对比度 ${contrastOnWhite(css)}` : '缺失'}` +
        `  ↔  TS ${p.ts} 对比度 ${contrastOnWhite(hexToRgb(p.ts))}`
    )
  }
  if (problems.length) {
    console.error(`\n[color-channel-parity] FAIL：${problems.length} 处`)
    problems.forEach((p) => console.error('  ✗ ' + p))
    process.exit(1)
  }
  console.log(
    `[color-channel-parity] OK：${SEMANTIC_PAIRS.length} 组语义色两侧成对存在；` +
      `权威源外无未登记的裸 hex`
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
