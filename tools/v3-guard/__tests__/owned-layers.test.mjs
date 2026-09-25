// @vitest-environment node
/**
 * owned-layers 的自测（含红样）。
 *
 * 钉六组事：
 *   1) 卸载钩子里**直接** remove ⇒ 必报（判据 A，921→924 四轮复发的那类）；
 *   2) 卸载钩子里**间接**注销（调 clear*Layers / remove*Layers / releaseAll）⇒ 必报
 *      （判据 B —— 换成封装函数这种同义记法不能变成绕过口）；
 *   3) business 下裸 `manager.register(` ⇒ 必报（判据 C，注册点分母）；
 *   4) 注册经 owned / ownedLayers ⇒ 不报（判据 C 的正向对照）；
 *   5) **主动清** + 注释提及 ⇒ 不报（口径收窄处）；
 *   6) clearTimeout / stopBreathing 这类非图层清理 ⇒ 不误伤。
 */
import { describe, expect, it } from 'vitest'

import { auditSources, layerRegisterSites, unmountBlocks } from '../owned-layers.mjs'

const src = (text, relPath = 'frontend/src/business/x/XPage.vue') => [{ relPath, text }]

describe('owned-layers — 图层归属结构约束', () => {
  it('@guard-red-sample 卸载钩子里 manager.remove ⇒ 必报', () => {
    const t = ['onUnmounted(() => {', "  manager.remove('a')", '})'].join('\n')
    const problems = auditSources(src(t))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('unmount-remove')
  })

  it('@guard-red-sample onBeforeUnmount 同样管；businessLayerManager 前缀也认', () => {
    const t = ['onBeforeUnmount(() => {', "  businessLayerManager.remove('b')", '})'].join('\n')
    expect(auditSources(src(t))).toHaveLength(1)
  })

  it('@guard-red-sample 卸载钩子里**间接**注销（调 clear*Layers）⇒ 必报', () => {
    const t = ['onUnmounted(() => {', '  clearRouteLayers()', '})'].join('\n')
    const problems = auditSources(src(t))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('unmount-indirect')
  })

  it('@guard-red-sample releaseAll / remove*Layers 形态也认（同义改写不能绕）', () => {
    const a = ['onUnmounted(() => {', '  ownedLayers.releaseAll()', '})'].join('\n')
    const b = ['onUnmounted(() => {', '  removeCesiumOnlyLayers()', '})'].join('\n')
    expect(auditSources(src(a))[0]).toContain('unmount-indirect')
    expect(auditSources(src(b))[0]).toContain('unmount-indirect')
  })

  it('@guard-red-sample business 下裸 manager.register ⇒ 必报（判据 C）', () => {
    const t = ['function f() {', "  manager.register('k', {})", '}'].join('\n')
    const problems = auditSources(src(t))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('bare-register')
  })

  it('@guard-red-sample 裸 businessLayerManager.register（换变量名）⇒ 仍必报', () => {
    const t = ['function f() {', "  businessLayerManager.register('k', {})", '}'].join('\n')
    expect(auditSources(src(t))[0]).toContain('bare-register')
  })

  it('注册经 owned / ownedLayers ⇒ 不报（判据 C 正向对照）', () => {
    const a = ['function f() {', "  owned.register('k', {})", '}'].join('\n')
    const b = ['function f() {', "  ownedLayers.register('k', {})", '}'].join('\n')
    expect(auditSources(src(a))).toEqual([])
    expect(auditSources(src(b))).toEqual([])
  })

  it('主动清（写在自己函数里，不在卸载钩子）⇒ 不报', () => {
    const t = ['function removeCesiumOnlyLayers() {', "  manager.remove('a')", '}'].join('\n')
    expect(auditSources(src(t))).toEqual([])
  })

  it('卸载钩子里的**注释**提及 ⇒ 不报', () => {
    const t = ['onUnmounted(() => {', '  // 页面不需要、也不应该自己调 manager.remove', '})'].join(
      '\n'
    )
    expect(auditSources(src(t))).toEqual([])
  })

  it('clearTimeout / stopBreathing / removeEventListener ⇒ 不误伤（口径收窄处）', () => {
    const t = [
      'onUnmounted(() => {',
      '  if (timer) clearTimeout(timer)',
      '  stopBreathing()',
      '  document.removeEventListener("click", h)',
      '})',
    ].join('\n')
    expect(auditSources(src(t))).toEqual([])
  })

  it('layerRegisterSites 给出分母与已接数（含经 owner 册的那些）', () => {
    const t = [
      "owned.register('a', {})",
      "ownedLayers.register('b', {})",
      "businessLayerManager.register('c', {})",
    ].join('\n')
    const sites = layerRegisterSites(src(t))
    expect(sites).toHaveLength(3)
    expect(sites.filter((s) => s.owned)).toHaveLength(2)
  })

  it('基线命中 ⇒ 该项不报（豁免口可对账）', () => {
    const t = ['onUnmounted(() => {', '  clearAnalysisLayers()', '})'].join('\n')
    const relPath = 'frontend/src/business/site-selection/SiteSelectionPage.vue'
    expect(auditSources(src(t, relPath))).toEqual([])
    expect(
      auditSources([{ relPath, text: t }], {
        baseline: ['unmount-indirect@' + relPath],
      })
    ).toEqual([])
  })

  it('unmountBlocks 能配平取块（嵌套大括号不漏不溢）', () => {
    const t = ['onUnmounted(() => {', '  if (x) { y() }', '  z()', '})', 'after()'].join('\n')
    const blocks = unmountBlocks(t)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].map((l) => l.text).join('\n')).toContain('z()')
    expect(blocks[0].map((l) => l.text).join('\n')).not.toContain('after()')
  })
})
