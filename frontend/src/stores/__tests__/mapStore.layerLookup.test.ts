// U10 判据：目录键查找只经 mapStore.findLayerEntry / findLayerEntryIndex 单一入口。
// 结构层用 typescript AST 扫两个消费文件（store 与图层面板），行为层直接打 store。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPinia, setActivePinia } from 'pinia'
import ts from 'typescript'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', '..')
const STORE_REL = 'stores/mapStore.ts'
const PANEL_REL = 'core/map/components/LayerControlPanel.vue'

// mock localStorage（baseLayerKey 持久化）
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
})

import { useMapStore } from '../mapStore'

function readSource(rel: string): string {
  const text = fs.readFileSync(path.join(SRC, rel), 'utf8')
  if (!text.includes('<script')) return text
  // .vue 只扫 script 区，非 script 行置空以保持行号
  let inside = false
  return text
    .split('\n')
    .map((line) => {
      if (/<script\b/i.test(line)) {
        inside = true
        return ''
      }
      if (/<\/script>/i.test(line)) {
        inside = false
        return ''
      }
      return inside ? line : ''
    })
    .join('\n')
}

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true)
}

/** 手抄形态：layerCatalog.value.find/findIndex((e: LayerEntry) => e.key === key) */
function inlineLayerKeyFinds(sf: ts.SourceFile): Array<{ line: number; text: string }> {
  const hits: Array<{ line: number; text: string }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isCatalogFind =
        ts.isPropertyAccessExpression(callee) &&
        (callee.name.text === 'find' || callee.name.text === 'findIndex') &&
        callee.expression.getText(sf) === 'layerCatalog.value'
      const arg = node.arguments[0]
      if (isCatalogFind && arg && /\.key\s*===\s*key\b/.test(arg.getText(sf))) {
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

/** 具名函数声明（含体内）的行区间 */
function functionBodyLines(sf: ts.SourceFile, name: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      ranges.push([
        sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
      ])
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return ranges
}

/** 具名调用数（同时计裸标识符 fn(...) 与属性访问 obj.fn(...)） */
function callsToMember(sf: ts.SourceFile, name: string): number {
  let count = 0
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && callee.text === name) count += 1
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === name) count += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return count
}

const HAND_WRITTEN_SAMPLE = parse(
  [
    'const a = layerCatalog.value.find((e: LayerEntry) => e.key === key)',
    'const b = layerCatalog.value.findIndex((e: LayerEntry) => e.key === key)',
  ].join('\n')
)

const NEAR_MISS_SAMPLE = parse(
  [
    'const a = presentable.find((l: LayerEntry) => l.key === key)',
    'const b = layerCatalog.value.filter((e: LayerEntry) => e.key === key)',
    'const c = layerCatalog.value.find((e: LayerEntry) => e.key !== key)',
    "const s = 'layerCatalog.value.find((e: LayerEntry) => e.key === key)'",
    '// layerCatalog.value.find((e: LayerEntry) => e.key === key)',
    'const d = mapStore.findLayerEntry(key)',
  ].join('\n')
)

describe('U10：目录键查找单一入口', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    storage.clear()
  })

  it('🔴 @guard-red-sample 内联手抄谓词零命中，两消费文件都走 findLayerEntry', () => {
    const storeText = readSource(STORE_REL)
    const panelText = readSource(PANEL_REL)
    const storeSf = parse(storeText)
    const panelSf = parse(panelText)

    // 权威件：手抄谓词只许落在两个 helper 自身函数体内（helper 怎么写不锁形态——
    // 提常量/换等价 API 不得误红），helper 之外零命中
    const helperRanges = [
      ...functionBodyLines(storeSf, 'findLayerEntry'),
      ...functionBodyLines(storeSf, 'findLayerEntryIndex'),
    ]
    expect(helperRanges).toHaveLength(2)
    const outsideHits = inlineLayerKeyFinds(storeSf).filter(
      (hit) => !helperRanges.some(([start, end]) => hit.line >= start && hit.line <= end)
    )
    expect(outsideHits).toEqual([])

    // 面板侧不得再手抄（它读 store 的入口）
    expect(inlineLayerKeyFinds(panelSf)).toEqual([])

    // 调用面：store 内 3 处 find + 2 处 findIndex；面板 1 处
    expect(callsToMember(storeSf, 'findLayerEntry')).toBe(3)
    expect(callsToMember(storeSf, 'findLayerEntryIndex')).toBe(2)
    expect(callsToMember(panelSf, 'findLayerEntry')).toBe(1)
  })

  it('扫描器能咬手抄（阳性对照 2 命中）且不误咬近失', () => {
    expect(inlineLayerKeyFinds(HAND_WRITTEN_SAMPLE)).toHaveLength(2)
    expect(inlineLayerKeyFinds(NEAR_MISS_SAMPLE)).toEqual([])
  })

  it('行为：命中返回条目/下标，未命中返回 undefined / -1', () => {
    const store = useMapStore()
    store.registerBusinessLayer('biz-a', '业务A', 'geojson')
    expect(store.findLayerEntry('biz-a')?.key).toBe('biz-a')
    expect(store.findLayerEntry('missing')).toBeUndefined()
    expect(store.findLayerEntryIndex('biz-a')).toBe(0)
    expect(store.findLayerEntryIndex('missing')).toBe(-1)
  })
})
