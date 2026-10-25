#!/usr/bin/env node
/**
 * color-channel-parity.mjs — CSS 通道与 canvas 通道的语义色对账（W67 / 根因 C 的 RC1 族）。
 *
 * ## 治什么
 *
 * 本项目有两条渲染通道，对同一语义色各需一份表示：
 *   · DOM/CSS 通道 → `frontend/src/style.css` 的 `--GCS-color-*`（可读 CSS 变量）
 *   · canvas/WebGL 通道 → `frontend/src/shared/constants/colors.ts` 的 `SEMANTIC_COLORS`
 *     （canvas 读不到 `var(--GCS-*)`，这是物理限制，不是取舍）
 *
 * 2026-10-25 用户裁决 C：不再让两侧各存一份副本，而是**一个单源表 + ui/map 两个变体**。
 * ui 变体必须逐值等于 CSS 亮色语义色（零 UI 回归）；map 变体用于地图侧（洪涝 stroke/fill），
 * 按**实际地图背景**取 ≥3:1，允许比 ui 更深。
 *
 * ## 判据（本守卫只判「可派生的事实」）
 *
 *   1. **ui ≡ CSS（严格相等）**：`SEMANTIC_COLORS.<key>.ui` 必须逐值等于
 *      `style.css` 亮色 `--GCS-color-<key>` 的 rgb 三元组。任一方向单改即红。
 *   2. **map 对比度 ≥3:1**：按 `SEMANTIC_MAP_BACKGROUND`（水面层实色基色）计算，
 *      **不是**按 `--GCS-bg` 白底算——地图画布不是面板，白底会高估可读性。
 *   3. **背景常量可复核**：`SEMANTIC_MAP_BACKGROUND` 必须等于 `LAYER_FILL_WATER` 的 RGB
 *      分量；水面层换色而背景常量不跟 ⇒ 红。
 *   4. **消费侧不绕表**：`FLOOD_RISK_COLORS` 的 stroke 必须引用 `<key>.map`，不得引用 `.ui`
 *      （ui 值在深色水面上不达标，等于把变体用错通道）。
 *   5. **零散落**：除权威源 `colors.ts` 外，`.ts`/`.vue` 生产代码里不得出现裸 hex 字面量；
 *      确有必要（业务专属色表）必须在 `ALLOWED_HEX_FILES` 里登记并写理由。
 *      **本笔收紧了豁免面**：洪涝风险色表与 SankeyChart 的近失字面量已并入单源，
 *      两条豁免随之删除（不是挪到别处）。
 *
 * ## 为什么不是 stylelint 扩展
 *
 * `.stylelintrc.json` 的 `color-no-hex` 只覆盖 `frontend/src` 下 css/vue 的样式块，
 * `.ts` 文件根本不在它的解析面里。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { walkFiles } from './lib/walk.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const STYLE_FILE = 'frontend/src/style.css'
/** 渲染色权威源：canvas 通道的唯一具名色表（含 SEMANTIC_COLORS 单源语义色） */
export const COLOR_AUTH = 'frontend/src/shared/constants/colors.ts'
/** 地图侧语义色的消费点：必须引用 map 变体，不得绕表 */
export const FLOOD_COLORS_FILE = 'frontend/src/business/flood-analysis/constants/colors.ts'

/** 地图侧对比度下限（用户裁决 C：地图侧 ≥3:1，不达标就变深） */
export const MAP_CONTRAST_MIN = 3

/**
 * 语义色对账表：CSS 变量名 ↔ SEMANTIC_COLORS 键。
 *
 * 键名两侧必须同名：`--GCS-color-success` ↔ `SEMANTIC_COLORS.success`。若将来出现
 * 「CSS 语义名与 TS 键名不同」的合法情形，再显式加映射字段；当前三组同名，不提前抽象。
 */
export const SEMANTIC_PAIRS = [
  { css: 'success', key: 'success', note: '成功/低风险' },
  { css: 'warning', key: 'warning', note: '警告/中风险' },
  { css: 'danger', key: 'danger', note: '危险/高风险' },
]

/** 单源表必须覆盖的语义键（与 SEMANTIC_PAIRS 的 key 集合一致） */
export const SEMANTIC_KEYS = SEMANTIC_PAIRS.map((p) => p.key)

/**
 * 允许出现裸 hex 的 `.ts`/`.vue` 文件（除权威源外）。
 * 每条必须写「为什么它不能引用权威源」。
 *
 * 2026-10-25：洪涝风险色表改走 `SEMANTIC_COLORS.*.map`、SankeyChart 改走
 * `chartColor('textPrimary')`，两条豁免已删除。豁免面缩小，不是转移。
 */
export const ALLOWED_HEX_FILES = [
  {
    file: 'frontend/src/business/diversion/constants/diversionMap.ts',
    why:
      '分流弧线/运河线位配色：Cesium 弧线渲染需要 Material 用的纯色值，' +
      '与图层语义绑定（我方/对方/高亮三态），shared 无对应具名常量。' +
      '待评估是否并入 colors.ts。',
    exemptFromBareHex: true,
  },
]

const HEX_LITERAL_RE = /['"`](#[0-9a-fA-F]{3,8})['"`]/g

/** 从 CSS 文本取某语义色的 rgb 三元组（首次出现 = 亮色主题；暗色覆盖在后） */
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

const rgbToHex = (rgb) =>
  '#' +
  rgb
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')
    .toLowerCase()

/** WCAG 相对亮度 */
function relativeLuminance(rgb) {
  const f = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
}

/** 两色对比度（WCAG，原值不四舍五入；展示时才 toFixed） */
export function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg)
  const l2 = relativeLuminance(bg)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

/** 对比度（白底），供报告与测试用 */
export function contrastOnWhite(rgb) {
  return +contrastRatio(rgb, [255, 255, 255]).toFixed(2)
}

/**
 * 解析 `colors.ts` 的单源语义色表。
 *
 * 机器可读契约（写在 colors.ts 表头）：每个键保持
 * `key: { ui: '#rrggbb', map: '#rrggbb' }` 的单对象形态。允许换行/多空格/注释；
 * 解析不到即红——**不静默跳过**，否则改名后守卫会变成空转。
 *
 * @returns {{ entries: Record<string,{ui:string,map:string}>, background: string|null, problems: string[] }}
 */
export function parseSemanticTable(colorsText) {
  const problems = []
  const entries = {}
  if (!colorsText) {
    return {
      entries,
      background: null,
      problems: [`读不到权威源 ${COLOR_AUTH} —— 单源语义色表不存在，对账失去对象`],
    }
  }

  const block = colorsText.match(/export const SEMANTIC_COLORS\s*=\s*\{([\s\S]*?)\n\}\s*as const/)
  if (!block) {
    return {
      entries,
      background: null,
      problems: [
        `在 ${COLOR_AUTH} 里解析不到 \`export const SEMANTIC_COLORS = { … } as const\` —— ` +
          '表被删/改名，ui≡CSS 与 map≥3:1 两条判据都会失去对象',
      ],
    }
  }

  for (const key of SEMANTIC_KEYS) {
    const m = block[1].match(
      new RegExp(
        `(?:^|\\n)\\s*(?://[^\\n]*\\n\\s*)*${key}\\s*:\\s*\\{\\s*` +
          `(?://[^\\n]*\\n\\s*)*ui\\s*:\\s*'(#[0-9a-fA-F]{6})'\\s*,\\s*` +
          `map\\s*:\\s*'(#[0-9a-fA-F]{6})'\\s*,?\\s*\\}`
      )
    )
    if (!m) {
      problems.push(
        `SEMANTIC_COLORS.${key} 解析不到 —— 缺少 \`${key}: { ui: '#rrggbb', map: '#rrggbb' }\` ` +
          '（或字段名/引号形态被改；机器可读契约见 colors.ts 表头）'
      )
      continue
    }
    entries[key] = { ui: m[1].toLowerCase(), map: m[2].toLowerCase() }
  }

  // 表里出现未纳入对账的语义键 ⇒ 它没有 CSS 对应值，ui 变体的承诺无法验证
  const declared = [...block[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:\s*\{/gm)].map((m) => m[1])
  for (const k of declared) {
    if (!SEMANTIC_KEYS.includes(k)) {
      problems.push(
        `SEMANTIC_COLORS 出现未纳入对账的语义键「${k}」—— ` +
          '每个 ui 变体都必须有 CSS 亮色 token 对应，否则「ui 逐值等于 CSS」这条承诺是空话。' +
          '请同步 SEMANTIC_PAIRS（并先确认 style.css 有该 token）。'
      )
    }
  }

  const bg = colorsText.match(/export const SEMANTIC_MAP_BACKGROUND\s*=\s*'(#[0-9a-fA-F]{6})'/)
  if (!bg) {
    problems.push(
      `在 ${COLOR_AUTH} 里解析不到 SEMANTIC_MAP_BACKGROUND —— ` +
        'map 变体的对比度失去可复核背景，不能用白底代替'
    )
  }

  return { entries, background: bg ? bg[1].toLowerCase() : null, problems }
}

/**
 * 主判定（纯函数，便于测）。
 * @param {object} o
 * @param {string} o.cssText      style.css 内容
 * @param {Map<string,string>} o.sources  文件 → 内容（非测试生产代码）
 * @param {string} [o.colorsText] 权威源内容（缺省取 sources 里的 COLOR_AUTH，便于单测注入）
 * @param {Array} [o.pairs]       语义对账表
 * @param {Array} [o.allowed]     裸 hex 豁免清单
 */
export function auditColorParity({
  cssText,
  sources,
  pairs = SEMANTIC_PAIRS,
  allowed = ALLOWED_HEX_FILES,
  colorsText,
}) {
  const problems = []
  const authText = colorsText ?? sources.get(COLOR_AUTH)
  const table = parseSemanticTable(authText)
  problems.push(...table.problems)

  // 背景常量必须能从水面层复核：否则「按实际地图背景算」只是一句注释
  const water = authText?.match(
    /export const LAYER_FILL_WATER\s*=\s*'rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/
  )
  if (authText && !water) {
    problems.push(
      `在 ${COLOR_AUTH} 里解析不到 LAYER_FILL_WATER 的 RGB —— ` +
        'SEMANTIC_MAP_BACKGROUND 的取色依据（水面层基色）无法复核'
    )
  }
  if (table.background && water) {
    const bg = rgbToHex(hexToRgb(table.background))
    const fill = rgbToHex([Number(water[1]), Number(water[2]), Number(water[3])])
    if (bg !== fill) {
      problems.push(
        `SEMANTIC_MAP_BACKGROUND=${table.background} 与 LAYER_FILL_WATER 的基色 ${fill} 不等 —— ` +
          '地图背景代表色已漂移，map 对比度判据将按错背景计算'
      )
    }
  }

  const background = table.background ? hexToRgb(table.background) : null

  // 1. ui ≡ CSS（严格相等）；2. map 对比度
  for (const p of pairs) {
    const css = cssSemanticColor(cssText, p.css)
    if (!css) {
      problems.push(
        `--GCS-color-${p.css} 在 ${STYLE_FILE} 里解析不到 —— CSS 通道丢了这一色，` +
          `而 ${COLOR_AUTH} 的 ui 变体仍在。两侧必须逐值相等（成对存在是底线）。`
      )
      continue
    }
    const entry = table.entries[p.key]
    if (!entry) continue // 缺表项已由 parseSemanticTable 报过

    const cssHex = rgbToHex(css)
    if (cssHex !== entry.ui) {
      problems.push(
        `ui 变体漂移：--GCS-color-${p.css} 是 ${cssHex}（rgb(${css.join(' ')})），` +
          `而 SEMANTIC_COLORS.${p.key}.ui 是 ${entry.ui} —— ui 变体必须逐值等于 CSS 亮色，` +
          '否则 DOM 与 canvas 又回到「同一语义两种观感」。'
      )
    }

    if (background) {
      const ratio = contrastRatio(hexToRgb(entry.map), background)
      if (ratio < MAP_CONTRAST_MIN) {
        problems.push(
          `map 变体对比度不足：SEMANTIC_COLORS.${p.key}.map=${entry.map} 在背景 ` +
            `${table.background}（${p.note}）上只有 ${ratio.toFixed(2)}:1 < ${MAP_CONTRAST_MIN}:1 —— ` +
            '地图侧允许变深，把该值调深到达标；不得把旧的 2.24/2.19/2.90 当基准。'
        )
      }
    }
  }

  // 3. 消费侧必须走 map 变体（走 ui 是把不达标的色搬回地图）
  const flood = sources.get(FLOOD_COLORS_FILE)
  if (!flood) {
    problems.push(
      `${FLOOD_COLORS_FILE} 不在判据域 —— 洪涝风险色表被删/改名，` +
        '「stroke 必须取 map 变体」这条判据失去对象'
    )
  } else {
    for (const p of pairs) {
      if (!new RegExp(`SEMANTIC_COLORS\\.${p.key}\\.map\\b`).test(flood)) {
        problems.push(
          `${FLOOD_COLORS_FILE} 未引用 SEMANTIC_COLORS.${p.key}.map —— ` +
            '洪涝 stroke 必须从单源表取 map 变体，不得另写字面量或换用 ui 变体。'
        )
      }
      if (new RegExp(`SEMANTIC_COLORS\\.${p.key}\\.ui\\b`).test(flood)) {
        problems.push(
          `${FLOOD_COLORS_FILE} 引用了 SEMANTIC_COLORS.${p.key}.ui —— ` +
            'ui 变体在深色水面上不达标（<3:1），地图侧必须用 map 变体。'
        )
      }
    }
  }

  // 4. 零散落：权威源之外不许有裸 hex
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

  return { problems, table, background }
}

function listSources() {
  // 声明文件（.d.ts）与测试夹具都不是语义色消费方，故在判据里排除（不是靠目录跳过）
  return walkFiles(path.join(ROOT, 'frontend/src'), {
    match: (name) => /\.(ts|tsx|vue)$/.test(name) && !/\.d\.ts$/.test(name),
    relBase: ROOT,
  })
    .filter((rel) => !/\.(test|spec)\./.test(rel) && !/__tests__/.test(rel))
    .sort()
}

function main() {
  const cssText = fs.readFileSync(path.join(ROOT, STYLE_FILE), 'utf8')
  const sources = new Map()
  for (const f of listSources()) sources.set(f, fs.readFileSync(path.join(ROOT, f), 'utf8'))

  const { problems, table } = auditColorParity({ cssText, sources })

  console.log(
    `[color-channel-parity] CSS ${STYLE_FILE} × canvas ${COLOR_AUTH}（地图背景 ${table.background ?? '缺失'}）`
  )
  for (const p of SEMANTIC_PAIRS) {
    const css = cssSemanticColor(cssText, p.css)
    const e = table.entries[p.key]
    const mapRatio =
      e && table.background
        ? contrastRatio(hexToRgb(e.map), hexToRgb(table.background)).toFixed(2)
        : '—'
    console.log(
      `  --GCS-color-${p.css.padEnd(8)} ` +
        `${css ? `rgb(${css.join(' ')})` : '缺失'}  ↔  ui ${e?.ui ?? '缺失'}` +
        `  map ${e?.map ?? '缺失'} 对比度 ${mapRatio}:1`
    )
  }
  if (problems.length) {
    console.error(`\n[color-channel-parity] FAIL：${problems.length} 处`)
    problems.forEach((p) => console.error('  ✗ ' + p))
    process.exit(1)
  }
  console.log(
    `[color-channel-parity] OK：${SEMANTIC_PAIRS.length} 组语义色 ui 逐值等于 CSS 亮色；` +
      `map 全部 ≥${MAP_CONTRAST_MIN}:1；洪涝 stroke 全走 map 变体；` +
      `权威源外无未登记的裸 hex`
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
