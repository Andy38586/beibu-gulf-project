// @vitest-environment node
/**
 * owned-layers 的自测（含红样）。
 *
 * 钉三件事：
 *   1) 卸载钩子里手写 remove ⇒ 必报（这是 921→924 四轮复发的那类）；
 *   2) **主动清**（写在自己函数里，如 removeCesiumOnlyLayers）⇒ 不报（口径收窄处）；
 *   3) 注释里的提及 ⇒ 不报（否则文件头那句「页面不需要自己调 manager.remove」
 *      会被自己判违规）。
 */
import { describe, expect, it } from 'vitest'

import { auditPages, unmountBlocks } from '../owned-layers.mjs'

const page = (text) => [{ relPath: 'frontend/src/business/x/XPage.vue', text }]

describe('owned-layers — 卸载钩子不得手写图层注销', () => {
  it('@guard-red-sample 卸载钩子里 manager.remove ⇒ 必报', () => {
    const t = ['onUnmounted(() => {', "  manager.remove('a')", '})'].join('\n')
    const problems = auditPages(page(t))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('卸载钩子里手写图层注销')
  })

  it('@guard-red-sample onBeforeUnmount 同样管；businessLayerManager 前缀也认', () => {
    const t = ['onBeforeUnmount(() => {', "  businessLayerManager.remove('b')", '})'].join('\n')
    expect(auditPages(page(t))).toHaveLength(1)
  })

  it('主动清（写在自己函数里，不在卸载钩子）⇒ 不报', () => {
    const t = ['function removeCesiumOnlyLayers() {', "  manager.remove('a')", '}'].join('\n')
    expect(auditPages(page(t))).toEqual([])
  })

  it('卸载钩子里的**注释**提及 ⇒ 不报', () => {
    const t = ['onUnmounted(() => {', '  // 页面不需要、也不应该自己调 manager.remove', '})'].join(
      '\n'
    )
    expect(auditPages(page(t))).toEqual([])
  })

  it('unmountBlocks 能配平取块（嵌套大括号不漏不溢）', () => {
    const t = ['onUnmounted(() => {', '  if (x) { y() }', '  z()', '})', 'after()'].join('\n')
    const blocks = unmountBlocks(t)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].map((l) => l.text).join('\n')).toContain('z()')
    expect(blocks[0].map((l) => l.text).join('\n')).not.toContain('after()')
  })
})
