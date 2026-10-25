// @vitest-environment node
/**
 * color-channel-parity 自测（W67 / 用户裁决 C：单源表 + ui/map 变体）。
 *
 * 钉七件事：
 *   1) ui 变体与 CSS 亮色**严格相等**：任一侧单改 ⇒ 红（两个方向各一条）；
 *   2) map 变体按实际地图背景（SEMANTIC_MAP_BACKGROUND，水面基色）≥3:1，不达标 ⇒ 红；
 *   3) 背景常量必须等于 LAYER_FILL_WATER 的 RGB（取色依据可复核）；
 *   4) 洪涝色表必须引用 `.map`，引用 `.ui` ⇒ 红（变体用错通道）；
 *   5) 裸 hex 判据不放松：洪涝色表与 SankeyChart 的豁免已删除，字面量 ⇒ 红；
 *   6) 等价重构（换行/空格/注释、合规改深）⇒ 不红（阴性对照）；
 *   7) 对比度计算与 WCAG 阈值一致（判据数字本身可信）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  ALLOWED_HEX_FILES,
  COLOR_AUTH,
  FLOOD_COLORS_FILE,
  MAP_CONTRAST_MIN,
  SEMANTIC_AUTH,
  SEMANTIC_KEYS,
  SEMANTIC_PAIRS,
  auditColorParity,
  contrastOnWhite,
  contrastRatio,
  cssSemanticColor,
  parseSemanticTable,
} from '../color-channel-parity.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const CSS_OK = `
  --GCS-color-success: rgb(24 122 48);
  --GCS-color-warning: rgb(163 99 0);
  --GCS-color-danger: rgb(204 58 77);
`

/** 语义权威源：三组 ui/map + 可复核背景（Q-C1 B：独立文件） */
const COLORS_OK = `
export const SEMANTIC_COLORS = {
  success: { ui: '#187a30', map: '#125223' },
  warning: { ui: '#a36300', map: '#6b4100' },
  danger: { ui: '#cc3a4d', map: '#8a2230' },
} as const

export const SEMANTIC_MAP_BACKGROUND = '#409eff'
`

/** 渲染色权威源：水面层基色（背景常量的取色依据） */
const WATER_OK = `export const LAYER_FILL_WATER = 'rgba(64, 158, 255, 0.5)'`

/** 洪涝消费点：三档都取 map 变体 */
const FLOOD_OK = `
import { FLOOD_RISK_NEUTRAL_COLOR, SEMANTIC_COLORS, withAlpha } from '@/shared'
const riskTier = (stroke: string, alpha: number) => ({ stroke, fill: withAlpha(stroke, alpha) })
export const FLOOD_RISK_COLORS = {
  低风险: riskTier(SEMANTIC_COLORS.success.map, 0.3),
  中风险: riskTier(SEMANTIC_COLORS.warning.map, 0.3),
  高风险: riskTier(SEMANTIC_COLORS.danger.map, 0.3),
  极高风险: riskTier(SEMANTIC_COLORS.danger.map, 0.4),
  灾难级: riskTier(SEMANTIC_COLORS.danger.map, 0.5),
}
`

/** 基础判据域：权威源 + 洪涝消费点 + 一个干净文件（留出可判面） */
function baseSources(colorsText = COLORS_OK, floodText = FLOOD_OK, waterText = WATER_OK) {
  return new Map([
    [SEMANTIC_AUTH, colorsText],
    [COLOR_AUTH, waterText],
    [FLOOD_COLORS_FILE, floodText],
    ['frontend/src/clean.ts', 'export const C = 1\n'],
  ])
}

const audit = (overrides = {}) =>
  auditColorParity({
    cssText: CSS_OK,
    sources: baseSources(),
    ...overrides,
  }).problems.join('\n')

describe('color-channel-parity：ui 变体逐值等于 CSS 亮色', () => {
  it('基线：三组 ui/map + 可复核背景 + 洪涝走 map ⇒ 零问题（阴性对照）', () => {
    expect(auditColorParity({ cssText: CSS_OK, sources: baseSources() }).problems).toEqual([])
  })

  it('@guard-red-sample CSS 侧被单改（success 回退到旧绿）⇒ 必红', () => {
    const css = CSS_OK.replace('rgb(24 122 48)', 'rgb(103 194 58)')
    const out = audit({ cssText: css })
    expect(out).toContain('ui 变体漂移')
    expect(out).toContain('#67c23a')
    expect(out).toContain('SEMANTIC_COLORS.success.ui 是 #187a30')
  })

  it('@guard-red-sample TS 侧 ui 被单改（改成旧 canvas 绿）⇒ 必红（反方向）', () => {
    const colors = COLORS_OK.replace("ui: '#187a30'", "ui: '#67c23a'")
    const out = audit({ colorsText: colors })
    expect(out).toContain('ui 变体漂移')
    expect(out).toContain('#187a30')
  })

  it('@guard-red-sample CSS 侧丢一个语义色 ⇒ 必红（成对存在是底线）', () => {
    const css = CSS_OK.replace('  --GCS-color-warning: rgb(163 99 0);\n', '')
    const out = audit({ cssText: css })
    expect(out).toContain('--GCS-color-warning')
    expect(out).toContain('解析不到')
  })
})

describe('color-channel-parity：map 变体按实际地图背景 ≥3:1', () => {
  it('@guard-red-sample map 变体仍用旧值（#67C23A）⇒ 对比度不足必红', () => {
    const colors = COLORS_OK.replace("map: '#125223'", "map: '#67c23a'")
    const out = audit({ colorsText: colors })
    expect(out).toContain('map 变体对比度不足')
    expect(out).toContain('#67c23a')
    expect(out).toContain('3:1')
    // 判据按地图背景算，不是白底：旧绿在白底 2.24，在 #409eff 上更低
    expect(out).not.toContain('2.24:1')
  })

  it('@guard-red-sample 背景常量漂移（改成白底）⇒ 必红，不许用 --GCS-bg 冒充地图底', () => {
    const colors = COLORS_OK.replace(
      "export const SEMANTIC_MAP_BACKGROUND = '#409eff'",
      "export const SEMANTIC_MAP_BACKGROUND = '#ffffff'"
    )
    const out = audit({ colorsText: colors })
    expect(out).toContain('与 LAYER_FILL_WATER 的基色 #409eff 不等')
    expect(out).toContain('map 对比度判据将按错背景计算')
  })

  it('map 变体改深到达标（#0f4a20）⇒ 不红（合规调整不是违例）', () => {
    const colors = COLORS_OK.replace("map: '#125223'", "map: '#0f4a20'")
    expect(auditColorParity({ cssText: CSS_OK, sources: baseSources(colors) }).problems).toEqual([])
  })

  it('阈值常量 = 3（用户裁决 C 的口径，不许悄悄下调）', () => {
    expect(MAP_CONTRAST_MIN).toBe(3)
  })
})

describe('color-channel-parity：单源表结构必须可解析、不许多出无 CSS 对应的键', () => {
  it('@guard-red-sample 缺一个语义键 ⇒ 必红（不许静默跳过）', () => {
    const colors = COLORS_OK.replace("  warning: { ui: '#a36300', map: '#6b4100' },\n", '')
    const out = audit({ colorsText: colors })
    expect(out).toContain('SEMANTIC_COLORS.warning 解析不到')
    expect(out).toContain('机器可读契约')
  })

  it('@guard-red-sample 表里多出未对账的语义键 ⇒ 必红（ui 承诺无法验证）', () => {
    const colors = COLORS_OK.replace(
      '} as const',
      "  info: { ui: '#409eff', map: '#0050a0' },\n} as const"
    )
    const out = audit({ colorsText: colors })
    expect(out).toContain('未纳入对账的语义键「info」')
  })

  it('@guard-red-sample 整张表被删 ⇒ 必红（判据失去对象）', () => {
    const colors = COLORS_OK.replace(/export const SEMANTIC_COLORS[\s\S]*?\} as const\n/, '')
    const out = audit({ colorsText: colors })
    expect(out).toContain('解析不到 `export const SEMANTIC_COLORS')
  })

  it('等价重构：表换行/加空格/加注释、键顺序不变 ⇒ 不红', () => {
    const colors = COLORS_OK.replace(
      "  success: { ui: '#187a30', map: '#125223' },",
      "  // 成功语义：ui 与 CSS light 同值\n  success: {\n    ui:    '#187a30',\n    map:   '#125223',\n  },"
    )
    expect(auditColorParity({ cssText: CSS_OK, sources: baseSources(colors) }).problems).toEqual([])
  })
})

describe('color-channel-parity：消费侧必须走 map 变体', () => {
  it('@guard-red-sample 洪涝色表引用 .ui ⇒ 必红（变体用错通道）', () => {
    const flood = FLOOD_OK.replace('SEMANTIC_COLORS.success.map', 'SEMANTIC_COLORS.success.ui')
    const out = audit({ sources: baseSources(COLORS_OK, flood) })
    expect(out).toContain('引用了 SEMANTIC_COLORS.success.ui')
    expect(out).toContain('地图侧必须用 map 变体')
  })

  it('@guard-red-sample 洪涝色表被删/改名 ⇒ 必红（判据失去对象）', () => {
    const sources = baseSources()
    sources.delete(FLOOD_COLORS_FILE)
    const out = audit({ sources })
    expect(out).toContain('不在判据域')
  })

  it('@guard-red-sample 洪涝色表出现裸 hex ⇒ 必红（该文件的豁免已删除）', () => {
    const flood = FLOOD_OK.replace(
      'riskTier(SEMANTIC_COLORS.success.map, 0.3)',
      "riskTier('#67C23A', 0.3)"
    )
    const out = audit({ sources: baseSources(COLORS_OK, flood) })
    expect(out).toContain(`${FLOOD_COLORS_FILE}:5`)
    expect(out).toContain('#67C23A')
  })

  it('@guard-red-sample SankeyChart 近失字面量（#e5eaf3）⇒ 必红（豁免已删除）', () => {
    const sources = baseSources()
    sources.set(
      'frontend/src/visualization/charts/SankeyChart.vue',
      "<script setup lang=\"ts\">\nconst color = dark ? '#e5eaf3' : '#303133'\n</script>\n"
    )
    const out = audit({ sources })
    expect(out).toContain('SankeyChart.vue:2')
    expect(out).toContain('#e5eaf3')
  })
})

describe('color-channel-parity：豁免面与判据域', () => {
  it('@guard-red-sample 豁免清单不得覆盖判据域全部文件 ⇒ 必红', () => {
    const only = 'frontend/src/only.ts'
    const sources = new Map([
      [COLOR_AUTH, COLORS_OK],
      [only, "export const C = '#abcdef'\n"],
    ])
    const { problems } = auditColorParity({
      cssText: CSS_OK,
      sources,
      allowed: [{ file: only, why: '故意全豁免', exemptFromBareHex: true }],
    })
    expect(problems.join('\n')).toContain('豁免面覆盖了判据域全部文件')
  })

  it('已登记豁免的文件 ⇒ 不红（阴性对照）', () => {
    const exempt = ALLOWED_HEX_FILES.find((a) => a.exemptFromBareHex)
    const sources = baseSources()
    sources.set(exempt.file, "export const X = '#123456'\n")
    expect(auditColorParity({ cssText: CSS_OK, sources }).problems).toEqual([])
  })

  it('行注释与块注释里的 hex 不算裸 hex（注释不是色值来源）', () => {
    const sources = baseSources()
    sources.set('frontend/src/a.ts', '// 旧值 #abcdef\nexport const C = 1 /* #123456 */\n')
    expect(auditColorParity({ cssText: CSS_OK, sources }).problems).toEqual([])
  })
})

describe('对比度计算可信（判据数字本身要能被复核）', () => {
  it('白底：纯黑 21 / 纯白 1', () => {
    expect(contrastOnWhite([0, 0, 0])).toBe(21)
    expect(contrastOnWhite([255, 255, 255])).toBe(1)
  })

  it('同一旧绿：白底 2.24，地图背景 #409eff 上更低（证明背景不是白底）', () => {
    const oldGreen = [103, 194, 58]
    expect(contrastOnWhite(oldGreen)).toBe(2.24)
    const onMap = contrastRatio(oldGreen, [64, 158, 255])
    expect(onMap).toBeLessThan(2.24)
    expect(onMap).toBeLessThan(MAP_CONTRAST_MIN)
  })

  it('三组 map 变体在 #409eff 上都 ≥3:1（真值复核，不靠注释）', () => {
    const { table } = auditColorParity({ cssText: CSS_OK, sources: baseSources() })
    for (const key of SEMANTIC_KEYS) {
      const ratio = contrastRatio(
        [
          parseInt(table.entries[key].map.slice(1, 3), 16),
          parseInt(table.entries[key].map.slice(3, 5), 16),
          parseInt(table.entries[key].map.slice(5, 7), 16),
        ],
        [64, 158, 255]
      )
      expect(ratio, `${key} map 对比度`).toBeGreaterThanOrEqual(MAP_CONTRAST_MIN)
    }
  })

  it('语义对账表两条通道都写全（缺一即静默脱钩）', () => {
    for (const p of SEMANTIC_PAIRS) {
      expect(p.css, '缺 css 名').toBeTruthy()
      expect(p.key, '缺 TS 键名').toBeTruthy()
      expect(p.note, `${p.css} 缺对应说明`).toBeTruthy()
    }
    expect(SEMANTIC_KEYS).toEqual(['success', 'warning', 'danger'])
  })

  it('cssSemanticColor 解析不到时返回 null（不许把缺失当 0）', () => {
    expect(cssSemanticColor('--GCS-color-success: #123456;', 'success')).toBeNull()
    expect(cssSemanticColor(CSS_OK, 'success')).toEqual([24, 122, 48])
  })

  it('parseSemanticTable 读不到权威源 ⇒ 返回问题，不许当成空表通过', () => {
    const r = parseSemanticTable('')
    expect(r.problems.join('\n')).toContain('读不到权威源')
    expect(r.entries).toEqual({})
  })
})

describe('真仓集成：单源表与消费点现状必须自洽', () => {
  it('真实 style.css / semantic-colors.ts / colors.ts / 洪涝色表 ⇒ 零问题（防只改夹具）', () => {
    const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
    const sources = new Map([
      [SEMANTIC_AUTH, read(SEMANTIC_AUTH)],
      [COLOR_AUTH, read(COLOR_AUTH)],
      [FLOOD_COLORS_FILE, read(FLOOD_COLORS_FILE)],
      ['frontend/src/clean.ts', 'export const C = 1\n'],
    ])
    expect(auditColorParity({ cssText: read('frontend/src/style.css'), sources }).problems).toEqual(
      []
    )
  })
})
