import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import type { FeatureCollection } from 'geojson'

import type { FlyToOptions, LayerOptions, PointFeature, PolygonFeature } from '@/types'

import { MapRenderer } from '../MapRenderer'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 两个引擎实现（注册点收口的判据域；权威源 MapRenderer.ts 本身允许直写） */
const ENGINES = ['OLRenderer.ts', 'CesiumRenderer.ts']

/** 记录引擎侧显隐下落，验证「注册即应用待定意图」真的走到了引擎 */
class ProbeRenderer extends MapRenderer {
  applied: Array<[string, boolean]> = []
  constructor() {
    super({} as unknown as HTMLElement)
  }
  async init() {}
  addPointLayer(_id: string, _features: PointFeature[], _options: LayerOptions = {}) {}
  addPolygonLayer(_id: string, _features: PolygonFeature[], _options: LayerOptions = {}) {}
  addGeoJsonLayer(_id: string, _geojson: FeatureCollection, _options: LayerOptions = {}) {}
  getType() {
    return 'probe'
  }
  _doSetVisibility(id: string, visible: boolean) {
    this.applied.push([id, visible])
  }
  _doRemoveLayer(_layer: unknown) {}
  _doFlyTo(_target: unknown, _options: FlyToOptions) {}
}

/**
 * AST 扫「直写图层注册表」：`X._layers.set(...)` 的调用点行号。
 * 用 AST 而非文本子串 —— 注释、字符串、改名后的近字形都不该被判成命中。
 */
function registryWrites(
  sourceText: string,
  fileName = 'x.ts'
): Array<{ line: number; text: string }> {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true)
  const hits: Array<{ line: number; text: string }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const callee = node.expression
      if (
        callee.name.text === 'set' &&
        ts.isPropertyAccessExpression(callee.expression) &&
        callee.expression.name.text === '_layers'
      ) {
        hits.push({
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          text: node.getText(sf),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

/** AST 数某文件里 `X.registerLayer(...)` 的调用点 */
function registerLayerCalls(sourceText: string, fileName = 'x.ts'): number[] {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true)
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'registerLayer'
    ) {
      lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return lines
}

describe('registerLayer — 图层注册的唯一入口', () => {
  it('登记实例进 _layers：初始 visible=true、options 与差异字段（extra）一并落账', () => {
    const renderer = new ProbeRenderer()
    const instance = {}
    const options = { opacity: 0.5 }
    renderer.registerLayer('layer1', instance, options, { interactionHeavy: true })
    expect(renderer.hasLayer('layer1')).toBe(true)
    const state = renderer._layers.get('layer1')!
    expect(state.instance).toBe(instance)
    expect(state.visible).toBe(true)
    expect(state.options).toBe(options)
    expect(state.interactionHeavy).toBe(true)
  })

  it('🔴 @guard-red-sample 注册即应用挂起的显隐意图（摘掉 applyPendingVisibility 即红）', () => {
    // 治的失效：显隐意图先于创建到达（面板已关、图层后建）⇒ 只在 _layers 里 set 而不
    // apply，意图静默丢失：面板显示关闭、地图上却显示。
    const renderer = new ProbeRenderer()
    renderer.setVisibility('layer1', false)
    expect(renderer._pendingVisibility.has('layer1')).toBe(true)

    renderer.registerLayer('layer1', {})

    expect(renderer.applied).toEqual([['layer1', false]])
    expect(renderer._layers.get('layer1')!.visible).toBe(false)
    expect(renderer._pendingVisibility.has('layer1')).toBe(false)
  })

  it('无挂起意图时不下发显隐（避免注册即成一次多余引擎调用）', () => {
    const renderer = new ProbeRenderer()
    renderer.registerLayer('layer1', {})
    expect(renderer.applied).toEqual([])
    expect(renderer._layers.get('layer1')!.visible).toBe(true)
  })
})

describe('registerLayer — 两引擎不得绕过入口直写注册表', () => {
  it('@guard-red-sample 直写 X._layers.set 即红（两个引擎文件各扫一遍）', () => {
    for (const file of ENGINES) {
      const text = fs.readFileSync(path.join(HERE, '..', file), 'utf8')
      expect(registryWrites(text, file), `${file} 仍有直写图层注册表的站点`).toEqual([])
      expect(registerLayerCalls(text, file).length, `${file} 未走 registerLayer`).toBeGreaterThan(0)
    }
  })

  it('扫描器阳性对照：权威源 MapRenderer.ts 的 this._layers.set 必须被扫到', () => {
    const authority = fs.readFileSync(path.join(HERE, '..', 'MapRenderer.ts'), 'utf8')
    const hits = registryWrites(authority, 'MapRenderer.ts')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].text).toContain('this._layers.set')
  })

  it('扫描器近失对照：形似而名不同 / 非调用形态一律不咬', () => {
    expect(registryWrites("obj._layersMap.set('a', {})")).toEqual([])
    expect(registryWrites("other.layers.set('a', {})")).toEqual([])
    expect(registryWrites("const s = 'x._layers.set(a, b)'")).toEqual([])
    expect(registryWrites('// this._layers.set(id, layer)')).toEqual([])
  })
})
