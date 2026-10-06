// @vitest-environment node
/**
 * viewport-tier-single-source 的自测（含红样）。
 *
 * 钉四组事：
 *   1) @guard-red-sample —— 裸比较 LAYOUT_DESKTOP_MIN / LAYOUT_DRAWER_MIN
 *      （≥ / < / 反向写法）在消费侧 ⇒ **必报**；
 *   2) 阳性对照 —— 同一比较在唯一实现处 config.ts、以及 layoutTierFor 调用 ⇒ 不报；
 *   3) 豁免面 —— 测试文件与注释行 ⇒ 不报；
 *   4) 回归锚 —— 当前索引真实扫描必须为空（第二实现回来即 CI 红）。
 */
import { describe, expect, it } from 'vitest'

import {
  ALLOWED_FILES,
  auditViewportTier,
  BREAKPOINT_RE,
  collectCandidates,
} from '../viewport-tier-single-source.mjs'

const src = (text, relPath = 'frontend/src/core/layout/X.vue') => [{ relPath, text }]
const problemsOf = (text, relPath) => auditViewportTier(src(text, relPath))

describe('viewport-tier-single-source — 断点判定单一来源守卫', () => {
  it('@guard-red-sample 消费侧裸比较 window.innerWidth >= LAYOUT_DESKTOP_MIN ⇒ 必报', () => {
    const problems = problemsOf(`if (window.innerWidth >= LAYOUT_DESKTOP_MIN) return`)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('LAYOUT_DESKTOP_MIN')
  })

  it('@guard-red-sample 反向写法 width < LAYOUT_DRAWER_MIN ⇒ 必报（同义改写不逃逸）', () => {
    const problems = problemsOf(`const compact = width < LAYOUT_DRAWER_MIN`)
    expect(problems).toHaveLength(1)
  })

  it('@guard-red-sample 第二套 computed 判定 ⇒ 必报', () => {
    const t = [
      'return computed(() => {',
      "  if (width.value >= LAYOUT_DESKTOP_MIN) return 'desktop'",
      "  return 'drawer'",
      '})',
    ].join('\n')
    const problems = problemsOf(t, 'frontend/src/core/layout/useViewportTier.ts')
    expect(problems).toHaveLength(1)
  })

  it('阳性对照：唯一实现处 config.ts 与 layoutTierFor 调用 ⇒ 不报', () => {
    const impl = 'if (width >= LAYOUT_DESKTOP_MIN) return "desktop"'
    expect(problemsOf(impl, 'frontend/src/shared/layout/config.ts')).toEqual([])
    expect(
      problemsOf('export function layoutModeFor(width) {\n  return layoutTierFor(width)\n}')
    ).toEqual([])
    expect(problemsOf('const tier = computed(() => layoutTierFor(windowWidth.value))')).toEqual([])
  })

  it('豁免面：测试文件与注释行 ⇒ 不报', () => {
    expect(
      problemsOf(
        `expect(width >= LAYOUT_DESKTOP_MIN).toBe(true)`,
        'frontend/src/x/__tests__/a.test.ts'
      )
    ).toEqual([])
    expect(problemsOf(`// 反例：window.innerWidth >= LAYOUT_DESKTOP_MIN 是旧实现`)).toEqual([])
  })

  it('回归锚：当前索引内断点判定零第二实现（git grep --cached）', () => {
    expect(auditViewportTier(collectCandidates())).toEqual([])
  })

  it('判据清单非空（防判据被清空后恒绿）', () => {
    expect(BREAKPOINT_RE.source).toContain('LAYOUT_')
    expect(ALLOWED_FILES).toHaveLength(1)
  })
})
