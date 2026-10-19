// @vitest-environment node
/**
 * color-channel-parity 自测（W67 / RC1 族：跨通道语义色对账）。
 *
 * 钉五件事：
 *   1) CSS 侧语义色缺失 ⇒ 红（一侧被删一侧还在）
 *   2) TS 侧对账常量缺失 ⇒ 红（反方向同样）
 *   3) 权威源之外出现裸 hex ⇒ 红
 *   4) 已登记的豁免文件 / 权威源本身 ⇒ 不红（阴性对照）
 *   5) 对比度计算与 WCAG 阈值一致（判据数字本身可信）
 */
import { describe, expect, it } from 'vitest'

import {
  ALLOWED_HEX_FILES,
  COLOR_AUTH,
  SEMANTIC_PAIRS,
  auditColorParity,
  contrastOnWhite,
  cssSemanticColor,
} from '../color-channel-parity.mjs'

const CSS_OK = `
  --GCS-color-success: rgb(24 122 48);
  --GCS-color-warning: rgb(163 99 0);
  --GCS-color-danger: rgb(204 58 77);
`

/** TS 侧：三个对账 hex 都在 */
const TS_OK = new Map([
  [COLOR_AUTH, "export const CHART_COLORS = { accent: '#67C23A', w: '#E6A23C', d: '#F56C6C' }"],
])

describe('color-channel-parity：跨通道语义色必须成对存在', () => {
  it('@guard-red-sample CSS 侧丢一个语义色 ⇒ 必红', () => {
    const css = CSS_OK.replace('  --GCS-color-warning: rgb(163 99 0);\n', '')
    const { problems } = auditColorParity({ cssText: css, sources: TS_OK })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('--GCS-color-warning')
    expect(problems[0]).toContain('两侧必须成对存在')
  })

  it('@guard-red-sample TS 侧丢了对应色值 ⇒ 必红（反方向）', () => {
    const ts = new Map([[COLOR_AUTH, "export const CHART_COLORS = { accent: '#67C23A' }"]])
    const { problems } = auditColorParity({ cssText: CSS_OK, sources: ts })
    expect(problems.length).toBe(2) // warning 与 danger 两色在 TS 侧找不到
    expect(problems.join('\n')).toContain('#E6A23C')
    expect(problems.join('\n')).toContain('#F56C6C')
  })

  it('@guard-red-sample 权威源之外出现裸 hex ⇒ 必红', () => {
    const src = new Map([
      ...TS_OK,
      ['frontend/src/core/somewhere.ts', "export const C = '#abcdef'\n"],
    ])
    const { problems } = auditColorParity({ cssText: CSS_OK, sources: src })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('somewhere.ts:1')
    expect(problems[0]).toContain('#abcdef')
  })

  it('已登记豁免的文件 / 权威源本身 ⇒ 不红（阴性对照）', () => {
    const exempt = ALLOWED_HEX_FILES.find((a) => a.exemptFromBareHex)
    const src = new Map([
      ...TS_OK,
      [exempt.file, "export const X = '#123456'\n"],
      // 必须留出可判面：豁免不能覆盖判据域全部文件（见下一条用例）
      ['frontend/src/clean.ts', 'export const C = 1\n'],
    ])
    expect(auditColorParity({ cssText: CSS_OK, sources: src }).problems).toEqual([])
  })

  it('行注释与块注释里的 hex 不算裸 hex（注释不是色值来源）', () => {
    const src = new Map([
      ...TS_OK,
      ['frontend/src/a.ts', '// 旧值 #abcdef\nexport const C = 1 /* #123456 */\n'],
    ])
    expect(auditColorParity({ cssText: CSS_OK, sources: src }).problems).toEqual([])
  })

  // @guard-red-sample 豁免面不得把整个判据域盖住（W58「豁免覆盖全部候选 = 禁用判据」）
  it('@guard-red-sample 豁免清单不得覆盖判据域全部文件 ⇒ 必红', () => {
    const only = 'frontend/src/only.ts'
    const src = new Map([...TS_OK, [only, "export const C = '#abcdef'\n"]])
    // 把唯一那个文件也列进豁免：此时裸 hex 判据扫不到任何东西，等于被禁用
    const { problems } = auditColorParity({
      cssText: CSS_OK,
      sources: src,
      allowed: [{ file: only, why: '故意全豁免', exemptFromBareHex: true }],
    })
    expect(problems.join('\n')).toContain('豁免面覆盖了判据域全部文件')
  })
})

describe('对比度计算可信（判据数字本身要能被复核）', () => {
  it('白底：纯黑 21 / 纯白 1', () => {
    expect(contrastOnWhite([0, 0, 0])).toBe(21)
    expect(contrastOnWhite([255, 255, 255])).toBe(1)
  })

  it('实测两侧差距：CSS 提深值达 WCAG AA(4.5)，TS 旧值不达', () => {
    expect(contrastOnWhite([24, 122, 48])).toBeGreaterThanOrEqual(4.5) // --GCS-color-success
    expect(contrastOnWhite([103, 194, 58])).toBeLessThan(4.5) // #67C23A
  })

  it('语义色成对表两条通道都写全（缺一即静默脱钩）', () => {
    for (const p of SEMANTIC_PAIRS) {
      expect(p.css, '缺 css 名').toBeTruthy()
      expect(p.ts, '缺 ts 值').toBeTruthy()
      expect(p.note, `${p.css} 缺对应说明`).toBeTruthy()
    }
  })

  it('cssSemanticColor 解析不到时返回 null（不许把缺失当 0）', () => {
    expect(cssSemanticColor('--GCS-color-success: #123456;', 'success')).toBeNull()
    expect(cssSemanticColor(CSS_OK, 'success')).toEqual([24, 122, 48])
  })
})
