// @vitest-environment node
/**
 * layer-keys 的自测（含红样）。
 *
 * 钉六组事：
 *   1) @guard-red-sample —— 判据域三类（layer-order 数组 / 注册注销调用实参 /
 *      名字含 layerId|layerKey 的声明）各喂一条必定违例的输入 ⇒ **必报**；
 *   2) 阳性对照 —— 经权威表引用的写法（LAYER_KEYS / DEFAULT_LAYER_ORDER /
 *      forecastLayerId）⇒ **不报**；
 *   3) 判据域**收窄**面 —— 不在 (a)(b)(c) 三类里的同名字面量（对象属性值）⇒ 不报；
 *   4) **三类排除语境不误报** —— featureType / domain / Pick< 出现在判据域内 ⇒ 整行放过；
 *   5) 词表**派生**自权威表（不手抄）：从 layers.ts 文本解析，空表返回 []；
 *   6) 豁免基线只对 site-selection 生效（problems 空、exempted 非空）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  auditLayerKeys,
  BASELINE,
  deriveLayerKeys,
  inDomainLines,
  LAYER_KEYS,
  LAYERS_TABLE_REL,
} from '../layer-keys.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const src = (text, relPath = 'frontend/src/business/x/XPage.vue') => [{ relPath, text }]
const problemsOf = (text, relPath) => auditLayerKeys(src(text, relPath)).problems

describe('layer-keys — 图层 key 字面量守卫', () => {
  it('@guard-red-sample 注册调用实参裸写图层 key ⇒ 必报', () => {
    const t = "businessLayerManager.register('base-image', opts)"
    const problems = problemsOf(t)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("'base-image'")
  })

  it('@guard-red-sample layer-order 数组内裸写 ⇒ 必报', () => {
    const t = [
      '<LayerControlPanel',
      '  :layer-order="[',
      "    'boundary',",
      "    'ports',",
      '  ]"',
      '/>',
    ].join('\n')
    const problems = problemsOf(t)
    expect(problems).toHaveLength(2)
    expect(problems.map((p) => p.match(/'([^']+)'/)[1]).sort()).toEqual(['boundary', 'ports'])
  })

  it('@guard-red-sample 名字含 layerId/layerKey 的常量初始化裸写 ⇒ 必报', () => {
    const a = problemsOf("const floodLayerKey = 'flood-area'")
    const b = problemsOf("export const ROUTE_LAYER_ID = 'route-path'")
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })

  it('阳性对照：经权威表引用 / 模板串构造器 ⇒ 不报', () => {
    const t = [
      'ownedLayers.register(LAYER_KEYS.boundary, opts)',
      'const order = [...DEFAULT_LAYER_ORDER, forecastLayerId(indicator)]',
      'manager.setVisible(LAYER_KEYS.floodWaterSurface, true)',
    ].join('\n')
    expect(problemsOf(t)).toEqual([])
  })

  it('判据域收窄：不在 (a)(b)(c) 三类里的同名字面量 ⇒ 不报', () => {
    // 对象属性值、普通声明 —— 语义可能完全不同，刻意不纳入判据域
    const t = ["const style = { name: 'boundary' }", "const tag = 'ports'"].join('\n')
    expect(problemsOf(t)).toEqual([])
  })

  it('排除语境 featureType：判据域内也整行放过 ⇒ 不误报', () => {
    const t = "businessLayerManager.register('x', { featureType: 'flood-area' })"
    expect(problemsOf(t)).toEqual([])
  })

  it('排除语境 domain:：判据域内也整行放过 ⇒ 不误报', () => {
    const t = "taskStore.remove({ domain: 'route-path' })"
    expect(problemsOf(t)).toEqual([])
  })

  it('排除语境 Pick<>：判据域内也整行放过 ⇒ 不误报', () => {
    const t = "const x = manager.has(Pick<Resp, 'ports'>)"
    expect(problemsOf(t)).toEqual([])
  })

  it('注释行放过（文件头自述不会被自己判违规）', () => {
    const t = ["// layer-order 里的 'boundary' 说明", " * 又一处 'ports'"].join('\n')
    expect(problemsOf(t)).toEqual([])
  })

  it('测试文件与权威表自身不扫描', () => {
    expect(
      problemsOf("manager.register('base-image')", 'frontend/src/a/__tests__/x.test.ts')
    ).toEqual([])
    expect(
      problemsOf("manager.register('base-image')", 'frontend/src/shared/constants/layers.ts')
    ).toEqual([])
  })

  it('豁免基线：site-selection 路径命中 ⇒ problems 空、exempted 非空', () => {
    const t = "manager.register('base-image')"
    const r = auditLayerKeys(src(t, 'frontend/src/business/site-selection/SiteSelectionPage.vue'))
    expect(r.problems).toEqual([])
    expect(r.exempted).toHaveLength(1)
    expect(BASELINE).toEqual(['frontend/src/business/site-selection/'])
  })
})

describe('layer-keys — 词表派生与判据域', () => {
  // 判据形状＝「哪些键必须在 + 解析到的值数与表内成员名数一致」，**不钉长度字面量**：
  // 字面量既让每次加图层都红一次，又防不住成员被跳过而个数不变（如 `k: "v"` 换双引号，
  // deriveLayerKeys 的 `:\s*'([^']+)'` 会静默漏掉它，判据域随之缩而不自知）。
  it('词表从权威表派生（不手抄），承重键必在且与成员名数一致', () => {
    for (const key of ['base-image', 'base-vector', 'boundary', 'ports', 'route-endpoint'])
      expect(LAYER_KEYS).toContain(key)
    const table = readFileSync(path.join(ROOT, LAYERS_TABLE_REL), 'utf8')
    const 成员名 = [...table.matchAll(/^ {2}([A-Za-z_$][\w$]*):/gm)].map((m) => m[1])
    expect(成员名.length).toBeGreaterThan(0)
    expect(LAYER_KEYS).toHaveLength(成员名.length)
  })

  it('deriveLayerKeys：解析 LAYER_KEYS 对象值为数组；缺表返回 []', () => {
    const table = `export const LAYER_KEYS = {\n  baseImage: 'base-image',\n  ports: 'ports',\n} as const`
    expect(deriveLayerKeys(table)).toEqual(['base-image', 'ports'])
    expect(deriveLayerKeys('export const OTHER = 1')).toEqual([])
  })

  it('inDomainLines：layer-order 区域覆盖整个数组；普通行不入域', () => {
    const t = [':layer-order="[', "'boundary',", ']"', "const tag = 'ports'"].join('\n')
    const lines = inDomainLines(t)
    expect([...lines].sort()).toEqual([0, 1, 2])
  })
})
