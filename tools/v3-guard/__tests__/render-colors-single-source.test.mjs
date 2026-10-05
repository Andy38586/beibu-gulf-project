// @vitest-environment node
/**
 * render-colors-single-source 的自测（含红样）。
 *
 * 钉四组事：
 *   1) @guard-red-sample —— 三个哨兵色在业务/组件文件里手抄 ⇒ **必报**；
 *   2) 阳性对照 —— 同一色在 shared/constants/colors.ts 定义处 ⇒ 不报；
 *   3) 豁免面 —— 测试夹具与注释行 ⇒ 不报；
 *   4) 回归锚 —— 当前仓库真实扫描必须为空（P3：副本回来即 CI 红）。
 */
import { describe, expect, it } from 'vitest'

import {
  ALLOWED_FILES,
  auditRenderColors,
  collectCandidates,
  SENTINEL_COLORS,
} from '../render-colors-single-source.mjs'

const src = (text, relPath = 'frontend/src/business/x/X.vue') => [{ relPath, text }]
const problemsOf = (text, relPath) => auditRenderColors(src(text, relPath))

describe('render-colors-single-source — 渲染色单一来源守卫', () => {
  it('@guard-red-sample 兜底灰 #8a93a6 手抄进组件 ⇒ 必报', () => {
    const problems = problemsOf(`const fallback = '#8a93a6'`)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('#8a93a6')
  })

  it('@guard-red-sample 跨层蓝色 #3b82f6 手抄进 core ⇒ 必报', () => {
    const problems = problemsOf(
      `'flood-areas': { color: '#3b82f6' }`,
      'frontend/src/core/map/ir/LayerIR.ts'
    )
    expect(problems).toHaveLength(1)
  })

  it('@guard-red-sample 橙色 #f59e0b 手抄（大小写混写）⇒ 必报（同义改写不逃逸）', () => {
    const problems = problemsOf(`const c = "#F59E0B"`)
    expect(problems).toHaveLength(1)
  })

  it('阳性对照：唯一定义处 shared/constants/colors.ts ⇒ 不报', () => {
    const t = `export const RENDER_BLUE = '#3b82f6'\nexport const IR_FALLBACK_COLOR = '#8a93a6'`
    expect(problemsOf(t, 'frontend/src/shared/constants/colors.ts')).toEqual([])
    expect(problemsOf(t, ALLOWED_FILES[0])).toEqual([])
  })

  it('豁免面：测试夹具与注释行 ⇒ 不报', () => {
    expect(problemsOf(`color: '#3b82f6'`, 'frontend/src/x/__tests__/a.test.ts')).toEqual([])
    expect(problemsOf(`// 收口说明：#8a93a6 曾有三副本`)).toEqual([])
    expect(problemsOf(`<!-- 历史：#3b82f6 两处 -->`)).toEqual([])
  })

  it('边界：八位色 #8a93a611 不是哨兵值 ⇒ 不报', () => {
    expect(problemsOf(`const c = '#8a93a611'`)).toEqual([])
  })

  it('回归锚：当前索引内哨兵色零手抄副本（git grep --cached，不读工作树脏件）', () => {
    expect(auditRenderColors(collectCandidates())).toEqual([])
  })

  it('判据清单非空（防哨兵表被清空后恒绿）', () => {
    expect(SENTINEL_COLORS.length).toBeGreaterThanOrEqual(3)
  })
})
