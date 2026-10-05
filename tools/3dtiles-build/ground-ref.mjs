#!/usr/bin/env node
/**
 * ground-ref.mjs — 作业区「参考地面」查询（C 口径，roads/ground 共用**唯一实现**）。
 *
 * ## 为什么需要
 * 交付场地本身有起伏，而道路/地面层此前用**一个常数 u**（全池中位，双峰分布统计假象
 * −17.55）铺平 ⇒ 作业区窗口内 100% 顶点埋没（Δ 中位 −1.63 m）。C 口径 = 逐顶点向
 * 交付包几何查询「我脚下的地面多高」。
 *
 * ## 口径（与 tools/diag/probe-port-roads-vs-ground.py 同参）
 * - 来源 = **全交付包瓦片**（tileset 全树内容 uri 去重；t4/t5 单池覆盖率仅 0.1%，不可用）；
 * - 材质 = rail / concrete / opaque（**陆域池**：排除 water，防路被拉向海面）；
 * - 格 = 4 m 中位（每格 ≥3 点才建格）；查询 = 最近格中心，半径 r=48 m，超半径返回 null
 *   （调用方回落原常数口径——"超出保现状"）。
 * - **地面带**（实施新增，实测必要性）：只收 u∈[-24,-12] 的顶点（港区地面实测 −21~−12；>−5 为吊机/箱顶等
 *   构筑物面、实测 +5~+14.3，会以假台地污染最近格；<−25 为疏浚/穿模异常）。带外不建格。
 *
 * ## 语义
 * 交付包内容顶点是 root 局部 ENU（glTF Y-up）：E=x、N=−z、U=y（与 port-align 探针同读法；
 * 交付包 96 块内容**无嵌套 transform**，2026-10-05 实测）。
 *
 * 用法（诊断）：node tools/3dtiles-build/ground-ref.mjs [--tile-dir 目录]
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { readGLB } from './glb-read.mjs'

const CS = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
export const REF_MATS = new Set(['rail', 'concrete', 'opaque'])
export const REF_CELL = 4
export const REF_RADIUS = 48
/** 地面带（ENU 上向，米）：港区地面实测 −21~−12；>−5 为吊机/箱顶等构筑物面（实测 +5~+14.3），
 *  <−25 为疏浚/穿模异常。带外顶点不参与建格（会以构筑物假台地污染最近格）。 */
export const REF_BAND = [-24, -12]

const TILE_DIR = 'backend/static/qinzhou-port/tiles'

export function buildGroundRef({
  tileDir = TILE_DIR,
  cell = REF_CELL,
  radius = REF_RADIUS,
  mats = REF_MATS,
  band = REF_BAND,
} = {}) {
  const ts = JSON.parse(fs.readFileSync(path.join(tileDir, 'tileset.json'), 'utf8'))
  const uris = new Set()
  ;(function walk(node) {
    const uri = node.content?.uri
    if (uri) uris.add(uri)
    for (const c of node.children ?? []) walk(c)
  })(ts.root)
  // 回落：夹具/小包的 tileset 可以不写 content 引用（groundLevel 同款按目录扫描）。
  if (!uris.size) {
    for (const f of fs.readdirSync(tileDir)) if (f.endsWith('.glb')) uris.add(f)
  }
  if (!uris.size) throw new Error('ground-ref：交付包无内容瓦片（tileset 结构变了？）')

  const cnt = {}
  const bins = new Map() // key → [u, u, …]（每格 ≥3 点才建格）
  const OFS = 4096
  const ON = 8192
  const key = (ix, iz) => (ix + OFS) * ON + (iz + OFS)
  let vertices = 0
  for (const uri of uris) {
    const p = path.join(tileDir, uri)
    if (!fs.existsSync(p)) throw new Error('ground-ref：交付包缺件 ' + p)
    const { json, bin } = readGLB(p)
    for (const m of json.meshes ?? []) {
      for (const pr of m.primitives ?? []) {
        const name = json.materials?.[pr.material]?.name ?? ''
        if (!mats.has(name)) continue
        const a = json.accessors[pr.attributes.POSITION]
        if (!a) continue
        const bv = json.bufferViews[a.bufferView]
        const nc = NC[a.type]
        const sz = CS[a.componentType]
        const stride = bv.byteStride || sz * nc
        const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
        for (let i = 0; i < a.count; i++) {
          const off = base + i * stride
          const E = bin.readFloatLE(off)
          const U = bin.readFloatLE(off + sz)
          const Z = bin.readFloatLE(off + 2 * sz)
          const N = -Z
          if (band && (U < band[0] || U > band[1])) continue
          const k = key(Math.floor(E / cell), Math.floor(N / cell))
          let arr = bins.get(k)
          if (!arr) bins.set(k, (arr = []))
          arr.push(U)
          cnt[name] = (cnt[name] ?? 0) + 1
          vertices++
        }
      }
    }
  }
  const grid = new Map()
  for (const [k, arr] of bins) {
    if (arr.length < 3) continue
    arr.sort((x, y) => x - y)
    // 中位数取法须与探针（numpy.median）一致：偶数个取中间两者均值（否则跨实现差异可达 0.5 m）
    grid.set(
      k,
      arr.length % 2 ? arr[arr.length >> 1] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2
    )
  }

  const maxRing = Math.ceil(radius / cell)
  function nearestU(E, N, r = radius) {
    const ix = Math.floor(E / cell)
    const iz = Math.floor(N / cell)
    let best = null
    let bestD2 = r * r
    for (let dx = -maxRing; dx <= maxRing; dx++) {
      for (let dz = -maxRing; dz <= maxRing; dz++) {
        const u = grid.get(key(ix + dx, iz + dz))
        if (u === undefined) continue
        const cx = (ix + dx + 0.5) * cell
        const cz = (iz + dz + 0.5) * cell
        const d2 = (cx - E) * (cx - E) + (cz - N) * (cz - N)
        if (d2 <= bestD2) {
          bestD2 = d2
          best = u
        }
      }
    }
    return best
  }

  return {
    cell,
    radius,
    nearestU,
    grid,
    stats: { tiles: uris.size, vertices, cells: grid.size, mats: cnt },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => {
    const i = process.argv.indexOf('--' + k)
    return i > -1 ? process.argv[i + 1] : d
  }
  const ref = buildGroundRef({ tileDir: arg('tile-dir', TILE_DIR) })
  console.log(
    '参考地面：瓦片 %d ｜ 顶点 %d（%s）｜ %d m 格 %d 格 ｜ 半径 %d m',
    ref.stats.tiles,
    ref.stats.vertices,
    Object.entries(ref.stats.mats)
      .map(([k, v]) => k + ' ' + v)
      .join(' / '),
    ref.cell,
    ref.stats.cells,
    ref.radius
  )
}
