// @vitest-environment node
/**
 * flyto-single-entry 的自测（含红样）。
 *
 * 钉四组事：
 *   1) @guard-red-sample —— 三类裸飞（currentRenderer / getRenderer / 变量 renderer）
 *      与直接相机飞行各喂一条必定违例的输入 ⇒ **必报**；
 *   2) 阳性对照 —— useMapControls().flyTo / 渲染器实现层（core/map）⇒ **不报**；
 *   3) 注释行与测试文件 ⇒ 不报；
 *   4) 回归锚 —— 当前仓库消费侧真实扫描必须为空（否则 CI 红，而不是靠人记）。
 */
import { describe, expect, it } from 'vitest'

import { auditFlyTo, collectSources, FORBIDDEN } from '../flyto-single-entry.mjs'

const src = (text, relPath = 'frontend/src/business/x/X.vue') => [{ relPath, text }]
const problemsOf = (text, relPath) => auditFlyTo(src(text, relPath))

describe('flyto-single-entry — 飞行单入口守卫', () => {
  it('@guard-red-sample 裸渲染器 flyTo（mapStore.currentRenderer?.flyTo）⇒ 必报', () => {
    const problems = problemsOf('void mapStore.currentRenderer?.flyTo({ lng: 1, lat: 2 })')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('currentRenderer')
  })

  it('@guard-red-sample getRenderer()?.flyTo ⇒ 必报', () => {
    const problems = problemsOf('getRenderer()?.flyTo({ lng: 1, lat: 2 })')
    expect(problems).toHaveLength(1)
  })

  it('@guard-red-sample 局部变量 renderer.flyTo ⇒ 必报', () => {
    const problems = problemsOf('renderer.flyTo({ lng: 1, lat: 2 })')
    expect(problems).toHaveLength(1)
  })

  it('@guard-red-sample 直接相机飞行（viewer.camera.flyTo）⇒ 必报', () => {
    const problems = problemsOf('viewer.camera.flyTo({ destination })')
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('相机')
  })

  it('阳性对照：useMapControls().flyTo ⇒ 不报', () => {
    const t = [
      'const { flyTo } = useMapControls()',
      'flyTo({ lng: point.lng, lat: point.lat })',
      'flyTo(candidate, { height: 1000 })',
    ].join('\n')
    expect(problemsOf(t)).toEqual([])
  })

  it('实现层豁免：core/map 内的渲染器/相机实现 ⇒ 不报', () => {
    const t = 'this.viewer?.camera.flyTo({ destination: pos, duration: 1 })'
    expect(problemsOf(t, 'frontend/src/core/map/renderers/CesiumRenderer.ts')).toEqual([])
    expect(problemsOf(t, 'frontend/src/core/map/composables/useMapControls.ts')).toEqual([])
  })

  it('注释行与测试文件 ⇒ 不报', () => {
    expect(problemsOf('// renderer?.flyTo(...) 反例说明')).toEqual([])
    expect(problemsOf('renderer.flyTo({})', 'frontend/src/business/x/__tests__/a.test.ts')).toEqual(
      []
    )
  })

  it('回归锚：当前仓库消费侧零裸飞（真实扫描）', () => {
    expect(auditFlyTo(collectSources())).toEqual([])
  })

  it('判据清单非空（防判据域被清空后恒绿）', () => {
    expect(FORBIDDEN.length).toBeGreaterThanOrEqual(2)
  })
})
