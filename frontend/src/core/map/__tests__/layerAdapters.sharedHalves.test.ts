import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

import { LAYER_ADAPTERS } from '../layerAdapters'

/**
 * 单张影像覆盖 / 3D Tiles 的「创建 vs 重建」半边必须共用同一份实现。
 *
 * 起因：create 与 update 各自手抄同一段失败上行（返回值判失败 + warn + onError）与同一份
 * 3dtiles 载荷校验/渲染选项。任一侧漏改就只剩一半上行——与 04-D2/D4「失败必须在生产可见」
 * 直接冲突，而且不跑第二条路径就看不出来。收口后由 layerAdapters.ts 内的三个 helper
 * （applyImageOverlayOrReport / normalizeTiles3D / applyTiles3DOrReport）承担。
 *
 * 判据分两层：
 *   · 行为层 —— 重建路径的文案、先删后建顺序、渲染选项透传；
 *   · 结构层 —— 直接调渲染器与上行函数在权威文件里各只许出现一次（同义改写回退即红）。
 */

function cesiumLike(overrides: Record<string, unknown> = {}) {
  return {
    getType: () => 'cesium',
    removeLayer: vi.fn(),
    addImageOverlayLayer: vi.fn((_key: string, _data: unknown, _options: unknown) => true),
    add3DTilesLayer: vi.fn((_key: string, _url: string, _options: unknown) =>
      Promise.resolve(true)
    ),
    ...overrides,
  }
}

const TILES_DATA = { url: '/static/pinglu/tiles/tileset.json', maximumScreenSpaceError: 12 }
const IMAGE_DATA = { url: '/static/pinglu/imagery/madao.jpg', bbox: [1, 2, 3, 4], size: [10, 10] }

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true)
}

/** 计数「X.<method>(...)」形式的调用点（AST，非文本子串——注释/字符串里的同形不算）。 */
function countMethodCalls(sourceFile: ts.SourceFile, method: string): number {
  let count = 0
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === method
    ) {
      count++
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return count
}

/** 计数「fn(...)」形式的直接函数调用（区别于 X.method() 形式）。 */
function countCallsByName(sourceFile: ts.SourceFile, name: string): number {
  let count = 0
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    )
      count++
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return count
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const AUTHORITY = path.resolve(HERE, '..', 'layerAdapters.ts')

/** 阳性对照：收口前的两处手抄形态（两份 add3DTilesLayer + 两份 report3DTilesFailure）。 */
const DUPLICATED_SAMPLE = `
function a(renderer: any, key: string, payload: any, options: any) {
  report3DTilesFailure(Promise.resolve(renderer.add3DTilesLayer(key, payload.url, {})), key, '创建', options)
}
function b(renderer: any, key: string, payload: any, options: any) {
  report3DTilesFailure(Promise.resolve(renderer.add3DTilesLayer(key, payload.url, {})), key, '重建', options)
}
`

/** 近失对照：改名的调用、注释里的调用、字符串里的调用都不得被计数。 */
const NEAR_MISS_SAMPLE = `
function c(renderer: any) {
  // renderer.add3DTilesLayer(key, payload.url, tilesOptions)
  renderer.add3DTilesLayerX(key)
  const s = 'renderer.add3DTilesLayer('
  return s
}
`

describe('layerAdapters 的创建/重建共用半边', () => {
  it('3dtiles 重建失败走同一半边：先移除旧层、文案为「重建」', async () => {
    const onError = vi.fn()
    const renderer = cesiumLike({ add3DTilesLayer: vi.fn(() => Promise.resolve(false)) })
    LAYER_ADAPTERS['3dtiles'].update(renderer as never, 'tiles-r', TILES_DATA, { onError } as never)
    expect(renderer.removeLayer).toHaveBeenCalledWith('tiles-r')
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(String((onError.mock.calls[0][0] as Error).message)).toContain('3dtiles 图层重建失败')
  })

  it('3dtiles 创建失败文案为「创建」，且渲染选项透传 maximumScreenSpaceError', async () => {
    const onError = vi.fn()
    const renderer = cesiumLike({ add3DTilesLayer: vi.fn(() => Promise.resolve(false)) })
    LAYER_ADAPTERS['3dtiles'].create(renderer as never, 'tiles-c', TILES_DATA, { onError } as never)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(String((onError.mock.calls[0][0] as Error).message)).toContain('3dtiles 图层创建失败')
    const [key, url, tilesOptions] = renderer.add3DTilesLayer.mock.calls[0]
    expect(key).toBe('tiles-c')
    expect(url).toBe(TILES_DATA.url)
    expect((tilesOptions as { maximumScreenSpaceError?: number }).maximumScreenSpaceError).toBe(12)
  })

  it('imageOverlay 创建/重建失败文案按动作词区分', () => {
    const onErrorCreate = vi.fn()
    LAYER_ADAPTERS.imageOverlay.create(
      cesiumLike({ addImageOverlayLayer: vi.fn(() => false) }) as never,
      'img-c',
      IMAGE_DATA,
      { onError: onErrorCreate } as never
    )
    expect(String((onErrorCreate.mock.calls[0][0] as Error).message)).toContain(
      'imageOverlay 图层创建失败'
    )

    const onErrorRebuild = vi.fn()
    LAYER_ADAPTERS.imageOverlay.update(
      cesiumLike({ addImageOverlayLayer: vi.fn(() => false) }) as never,
      'img-r',
      IMAGE_DATA,
      { onError: onErrorRebuild } as never
    )
    expect(String((onErrorRebuild.mock.calls[0][0] as Error).message)).toContain(
      'imageOverlay 图层重建失败'
    )
  })

  it('重建遇到不合格载荷：不删旧层、不报错（与创建侧同一条校验）', () => {
    const onError = vi.fn()
    const tiles = cesiumLike()
    LAYER_ADAPTERS['3dtiles'].update(tiles as never, 'tiles-bad', {}, { onError } as never)
    expect(tiles.removeLayer).not.toHaveBeenCalled()
    expect(tiles.add3DTilesLayer).not.toHaveBeenCalled()

    const overlay = cesiumLike()
    LAYER_ADAPTERS.imageOverlay.update(overlay as never, 'img-bad', {}, { onError } as never)
    expect(overlay.removeLayer).not.toHaveBeenCalled()
    expect(overlay.addImageOverlayLayer).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('🔴 @guard-red-sample 半边只许一处：直调渲染器与上行函数在权威文件各一次', () => {
    const sourceFile = parse(fs.readFileSync(AUTHORITY, 'utf8'))
    expect(countMethodCalls(sourceFile, 'add3DTilesLayer')).toBe(1)
    expect(countMethodCalls(sourceFile, 'addImageOverlayLayer')).toBe(1)
    expect(countCallsByName(sourceFile, 'report3DTilesFailure')).toBe(1)

    // 阳性对照：同一计数器对收口前的两处手抄形态必须数出 2。
    const duplicated = parse(DUPLICATED_SAMPLE)
    expect(countMethodCalls(duplicated, 'add3DTilesLayer')).toBe(2)
    expect(countCallsByName(duplicated, 'report3DTilesFailure')).toBe(2)

    // 近失对照：改名调用 / 注释 / 字符串里的同形一律不计数。
    const nearMiss = parse(NEAR_MISS_SAMPLE)
    expect(countMethodCalls(nearMiss, 'add3DTilesLayer')).toBe(0)
    expect(countCallsByName(nearMiss, 'report3DTilesFailure')).toBe(0)
  })
})
