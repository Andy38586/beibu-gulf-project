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

import {
  auditSources,
  layerRegisterSites,
  looksLikeLayerTeardown,
  ownerScopeViolations,
  unmountBlocks,
} from '../owned-layers.mjs'

const src = (text, relPath = 'frontend/src/business/x/XPage.vue') => [{ relPath, text }]

describe('owned-layers — 图层归属结构约束', () => {
  it('@guard-red-sample 卸载钩子里 manager.remove ⇒ 必报', () => {
    const t = ['onUnmounted(() => {', "  manager.remove('a')", '})'].join('\n')
    const problems = auditSources(src(t))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('unmount-call')
  })

  it('@guard-red-sample onBeforeUnmount 同样管；businessLayerManager 前缀也认', () => {
    const t = ['onBeforeUnmount(() => {', "  businessLayerManager.remove('b')", '})'].join('\n')
    expect(auditSources(src(t))).toHaveLength(1)
  })

  it('@guard-red-sample 卸载钩子里**间接**注销（调 clear*Layers）⇒ 必报', () => {
    const t = ['onUnmounted(() => {', '  clearRouteLayers()', '})'].join('\n')
    const problems = auditSources(src(t))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('unmount-call')
  })

  it('@guard-red-sample releaseAll / remove*Layers 形态也认（同义改写不能绕）', () => {
    const a = ['onUnmounted(() => {', '  ownedLayers.releaseAll()', '})'].join('\n')
    const b = ['onUnmounted(() => {', '  removeCesiumOnlyLayers()', '})'].join('\n')
    expect(auditSources(src(a))[0]).toContain('unmount-call')
    expect(auditSources(src(b))[0]).toContain('unmount-call')
  })

  it('@guard-red-sample 换成别的名字（cleanupLayers / detachLayers / purgeAllLayers）⇒ 仍必报', () => {
    for (const call of ['cleanupLayers()', 'detachLayers()', 'purgeAllLayers()']) {
      const t = ['onUnmounted(() => {', `  ${call}`, '})'].join('\n')
      expect(auditSources(src(t))[0], call).toContain('unmount-call')
    }
  })

  it('@guard-red-sample 用 BLM 自己的 removeAll（名字里没有 Layers）⇒ 仍必报', () => {
    const t = ['onUnmounted(() => {', '  businessLayerManager.removeAll()', '})'].join('\n')
    expect(auditSources(src(t))[0]).toContain('unmount-call')
  })

  it('looksLikeLayerTeardown：认形态而非认名字（复核实测的三条 evasion 都在这）', () => {
    for (const n of [
      'cleanupLayers',
      'detachLayers',
      'purgeAllLayers',
      'removeAll',
      'removeLayer',
    ]) {
      expect(looksLikeLayerTeardown(n), `${n} 应判为注销`).toBe(true)
    }
    for (const n of [
      'clearTimeout',
      'clearInterval',
      'removeEventListener',
      'stopTilesLayerWatch',
      'cancelAll',
      'stopBreathing',
      'reset',
      'abort',
      // dispose / teardown 更常用于非图层资源（实测 ECharts 实例销毁被误伤）
      'dispose',
      'teardown',
    ]) {
      expect(looksLikeLayerTeardown(n), `${n} 不应判为注销`).toBe(false)
    }
  })

  it('卸载块内的非图层调用（定时器/监听/停 watch/取消/重置/abort）⇒ 不误伤', () => {
    const t = [
      'onUnmounted(() => {',
      '  clearTimeout(timer)',
      '  clearInterval(iv)',
      '  document.removeEventListener("click", h)',
      '  stopBreathing()',
      '  stopTilesLayerWatch()',
      '  cancelAll()',
      '  forecastState.reset()',
      '  poiAbort?.abort()',
      '  chartInstance.dispose()',
      '})',
    ].join('\n')
    expect(auditSources(src(t))).toEqual([])
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

  it('注册经 useOwnedLayers 派生的变量 ⇒ 不报（判据 C 正向对照）', () => {
    const a = ["const owned = useOwnedLayers('x')", "owned.register('k', {})"].join('\n')
    const b = ["const ownedLayers = useOwnedLayers('y')", "ownedLayers.register('k', {})"].join(
      '\n'
    )
    expect(auditSources(src(a))).toEqual([])
    expect(auditSources(src(b))).toEqual([])
  })

  it('@guard-red-sample owner 变量重命名 ⇒ 按数据流计入已接，不算裸注册', () => {
    const t = ["const panelOwned = useOwnedLayers('p')", "panelOwned.register('k', {})"].join('\n')
    expect(auditSources(src(t))).toEqual([])
    const sites = layerRegisterSites(src(t))
    expect(sites).toHaveLength(1)
    expect(sites[0].owned, '按数据流应识别为已接（旧判据会报 owned:false 而分母静默失真）').toBe(
      true
    )
  })

  it('@guard-red-sample 非 owner 变量 register ⇒ 必报（不再靠"变量名含 manager"）', () => {
    const t = ['function f() {', "  someThing.register('k', {})", '}'].join('\n')
    expect(auditSources(src(t))[0]).toContain('bare-register')
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

  it('layerRegisterSites 分母：按 useOwnedLayers 派生判定「已接」', () => {
    const t = [
      "const owned = useOwnedLayers('x')",
      "owned.register('a', {})",
      "businessLayerManager.register('c', {})",
    ].join('\n')
    const sites = layerRegisterSites(src(t))
    expect(sites).toHaveLength(2)
    expect(sites.filter((s) => s.owned)).toHaveLength(1)
  })

  it('基线命中 ⇒ 该项不报（豁免口可对账）', () => {
    const t = ['onUnmounted(() => {', '  clearAnalysisLayers()', '})'].join('\n')
    const relPath = 'frontend/src/business/site-selection/SiteSelectionPage.vue'
    expect(auditSources(src(t, relPath))).toEqual([])
    expect(
      auditSources([{ relPath, text: t }], {
        baseline: ['unmount-call@' + relPath],
      })
    ).toEqual([])
  })

  it('@guard-red-sample owner 建在子组件链路 ⇒ 必报（N-08 形态：归属短于业务寿命）', () => {
    const sources = [
      {
        relPath: 'frontend/src/business/x/composables/useFoo.ts',
        text: ['export function useFoo() {', '  return useOwnedLayers("foo")', '}'].join('\n'),
      },
      {
        relPath: 'frontend/src/business/x/components/Bar.vue',
        text: 'const { register } = useFoo()',
      },
    ]
    const problems = ownerScopeViolations(sources)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('owner-scope')
    expect(problems[0]).toContain('Bar.vue')
  })

  it('owner 被页面调用 / 页面自己建 owner ⇒ 不报（判据 D 正向对照）', () => {
    const viaPage = [
      {
        relPath: 'frontend/src/business/x/composables/useFoo.ts',
        text: ['export function useFoo() {', '  return useOwnedLayers("foo")', '}'].join('\n'),
      },
      { relPath: 'frontend/src/business/x/XPage.vue', text: 'const { register } = useFoo()' },
    ]
    expect(ownerScopeViolations(viaPage)).toEqual([])
    // 页面文件自己建册（src() 的默认 relPath 就是 *Page.vue）
    expect(ownerScopeViolations(src('const owned = useOwnedLayers("x")'))).toEqual([])
  })

  it('@guard-red-sample 非页面建 owner 且无可追踪 composable 导出 ⇒ 必报', () => {
    const sources = [
      {
        relPath: 'frontend/src/business/x/components/Bar.vue',
        text: 'const owned = useOwnedLayers("x")',
      },
    ]
    expect(ownerScopeViolations(sources)[0]).toContain('owner-scope')
  })

  it('@guard-red-sample 无词根的清理名（wipe / purgeEverything）⇒ 仍必报（白名单默认拒绝）', () => {
    for (const call of ['wipe()', 'purgeEverything()', 'teardownEverything()']) {
      const t = ['onUnmounted(() => {', `  ${call}`, '})'].join('\n')
      expect(auditSources(src(t))[0], call).toContain('unmount-call')
    }
  })

  it('白名单内的卸载收尾不报；容器方法不构成逃逸面（逐行扫描）', () => {
    const ok = [
      'onUnmounted(() => {',
      '  clearTimeout(t)',
      '  document.removeEventListener("click", h)',
      '  ids.forEach((i) => i.off())',
      '})',
    ].join('\n')
    expect(auditSources(src(ok))).toEqual([])
    // 容器方法本身在白名单里，但它内部那条 manager.remove 会被逐行抓出来
    const escape = ['onUnmounted(() => {', '  ids.forEach((i) => manager.remove(i))', '})'].join(
      '\n'
    )
    expect(auditSources(src(escape))[0]).toContain('remove')
  })

  it('unmountBlocks 能配平取块（嵌套大括号不漏不溢）', () => {
    const t = ['onUnmounted(() => {', '  if (x) { y() }', '  z()', '})', 'after()'].join('\n')
    const blocks = unmountBlocks(t)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].map((l) => l.text).join('\n')).toContain('z()')
    expect(blocks[0].map((l) => l.text).join('\n')).not.toContain('after()')
  })
})
