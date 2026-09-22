import { describe, expect, it } from 'vitest'

import {
  collectContentUris,
  evaluateTileset,
  evaluateTilesetPair,
  GENERATOR_MARKER,
  MIN_CONTENT_NODES,
  REQUIRED_CONTENT,
} from '../tiles3d-check.mjs'

/** 构造一个合法 tileset（可选覆盖 root / asset 字段） */
function makeTileset({ uris = REQUIRED_CONTENT, generator = `X + ${GENERATOR_MARKER} + Y`, root } = {}) {
  return {
    asset: { version: '1.1', generator },
    root: root ?? {
      transform: Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
      boundingVolume: { box: Array.from({ length: 12 }, () => 0) },
      children: uris.map((u) => ({ content: { uri: u } })),
    },
  }
}

const existsAll = () => true

describe('tiles3d-check — 瓦片集完整性的红绿对照', () => {
  it('完整瓦片集（31 项必需内容全在）→ 通过', () => {
    const ts = makeTileset()
    expect(evaluateTileset(ts, existsAll)).toEqual([])
    expect(collectContentUris(ts.root)).toHaveLength(MIN_CONTENT_NODES)
  })

  it('【阳性对照·核心】被不含 corridor/bridges 的模板覆盖（复刻 2026-09-21 事故）→ 必须报红', () => {
    // 还原事故：17 个枢纽内容，corridor-* 与 bridges-* 全部丢失，generator 退回 per-tile anchor fix
    const hubOnly = REQUIRED_CONTENT.filter(
      (u) => !u.startsWith('corridor-') && !u.startsWith('bridges-')
    )
    expect(hubOnly).toHaveLength(17) // 与事故现场实测的 17 节点一致
    const ts = makeTileset({
      uris: hubOnly,
      generator: 'PingluCanal Tiles Builder + WGS84 per-tile anchor fix (BV z-up ...)',
    })
    const problems = evaluateTileset(ts, existsAll)
    // 节点数不足 + 必需内容缺失 + generator 退化，三类问题都该命中
    expect(problems.some((p) => p.includes('内容节点 17 个 < 下限 31'))).toBe(true)
    expect(problems.some((p) => p.includes('corridor-00.glb'))).toBe(true)
    expect(problems.some((p) => p.includes('bridges-mid.glb'))).toBe(true)
    expect(problems.some((p) => p.includes(GENERATOR_MARKER))).toBe(true)
  })

  it('只丢桥梁（20 节点中间态）→ 仍报红，且指名 bridges-*', () => {
    const noBridges = REQUIRED_CONTENT.filter((u) => !u.startsWith('bridges-'))
    const ts = makeTileset({ uris: noBridges })
    const problems = evaluateTileset(ts, existsAll)
    expect(problems.some((p) => p.includes('内容节点 28 个 < 下限 31'))).toBe(true)
    expect(problems.some((p) => p.includes('bridges-') && p.includes('缺失'))).toBe(true)
  })

  it('generator 退回 per-tile anchor fix → 报红（坐标约定退化）', () => {
    const ts = makeTileset({ generator: 'PingluCanal + WGS84 per-tile anchor fix' })
    const problems = evaluateTileset(ts, existsAll)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(GENERATOR_MARKER)
  })

  it('悬空引用（uri 指向不存在的文件）→ 报红', () => {
    const ts = makeTileset()
    const missing = 'corridor-10.glb'
    const problems = evaluateTileset(ts, (u) => u !== missing)
    expect(problems.some((p) => p.includes('悬空引用') && p.includes(missing))).toBe(true)
  })

  it('root.transform 缺失 → 报红；root.boundingVolume.box 缺失 → 报红', () => {
    const noTransform = makeTileset()
    delete noTransform.root.transform
    expect(evaluateTileset(noTransform, existsAll).some((p) => p.includes('transform'))).toBe(true)

    const noBox = makeTileset()
    delete noBox.root.boundingVolume
    expect(evaluateTileset(noBox, existsAll).some((p) => p.includes('boundingVolume.box'))).toBe(
      true
    )
  })

  it('root 缺失 → 直接报错，不抛异常', () => {
    expect(evaluateTileset({}, existsAll)).toHaveLength(1)
    expect(evaluateTileset({ asset: {} }, existsAll)[0]).toContain('root')
  })

  it('节点数下限是硬编码 31：调低下限会让被覆盖的 17 节点版「假绿」', () => {
    const hubOnly = REQUIRED_CONTENT.filter(
      (u) => !u.startsWith('corridor-') && !u.startsWith('bridges-')
    )
    const ts = makeTileset({ uris: hubOnly })
    // 默认下限 → 报红
    expect(evaluateTileset(ts, existsAll).length).toBeGreaterThan(0)
    // 人为把下限降到 17 且只留 17 项必需内容 → 才会「假绿」
    const relaxed = evaluateTileset(ts, existsAll, { minContentNodes: 17 })
    expect(relaxed.some((p) => p.includes('内容节点'))).toBe(false)
  })
})

describe('evaluateTilesetPair — 1.1 与 1.0 索引套一致性', () => {
  it('同一套内容（.glb ↔ .b3dm）→ 通过', () => {
    const glb = makeTileset()
    const b3dm = makeTileset({
      uris: REQUIRED_CONTENT.map((u) => u.replace(/\.glb$/, '.b3dm')),
    })
    expect(evaluateTilesetPair(glb, b3dm)).toEqual([])
  })

  it('b3dm 套缺内容 → 报红，并指出缺哪个', () => {
    const glb = makeTileset()
    const b3dm = makeTileset({
      uris: REQUIRED_CONTENT.filter((u) => u !== 'corridor-05.glb').map((u) =>
        u.replace(/\.glb$/, '.b3dm')
      ),
    })
    const problems = evaluateTilesetPair(glb, b3dm)
    expect(problems.some((p) => p.includes('corridor-05'))).toBe(true)
  })

  it('b3dm 套整体缺失 → 报红', () => {
    expect(evaluateTilesetPair(makeTileset(), null)).toHaveLength(1)
  })
})
