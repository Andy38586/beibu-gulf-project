#!/usr/bin/env node
/**
 * 只读探针：运河带水面 vs 枢纽交付包自带水面的重叠取证。
 * 常设复算钩子：任何一次 canal.glb / pinglu 交付包重烘之后都应重跑——期望各枢纽
 * 只剩船闸主体窗（z3，交付包无水面材质）内的带子，引航道（z2/z6）段重叠=0。
 * 口径：pinglu/tiles 与 pinglu/canal 共用同一 root.transform ⇒ 本地 ENU 系可直接比较。
 * gltf→ENU 轴序走 `tools/3dtiles-build/glb.mjs` 的 gltfToEnu（唯一权威源，不自行实现）。
 * 输出：每枢纽 盒尺寸/运河带穿盒长度/重叠面积/两水面高度差（含分位）。
 */
import fs from 'node:fs'
import path from 'node:path'

import { gltfToEnu } from '../3dtiles-build/glb.mjs'

const TILES = 'backend/static/pinglu/tiles'
const CANAL = 'backend/static/pinglu/canal'

function loadGLB(file) {
  const b = fs.readFileSync(file)
  const jl = b.readUInt32LE(12)
  const json = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'))
  let bin = Buffer.alloc(0)
  let off = 20 + jl
  while (off + 8 <= b.length) {
    const len = b.readUInt32LE(off)
    const type = b.subarray(off + 4, off + 8).toString('ascii')
    if (type === 'BIN\u0000') bin = b.subarray(off + 8, off + 8 + len)
    off += 8 + len + ((4 - (len % 4)) % 4)
  }
  return { json, bin }
}
const CTYPE = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
}
const CSIZE = { VEC2: 2, VEC3: 3, VEC4: 4, SCALAR: 1 }
function readAccessor({ json, bin }, idx) {
  const a = json.accessors[idx]
  const bv = json.bufferViews[a.bufferView]
  const T = CTYPE[a.componentType]
  const n = CSIZE[a.type]
  const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const out = []
  const dv = new DataView(bin.buffer, bin.byteOffset + start, a.count * n * T.BYTES_PER_ELEMENT)
  for (let i = 0; i < a.count; i++)
    for (let k = 0; k < n; k++)
      out.push(
        dv[
          `get${T === Float32Array ? 'Float32' : T === Uint16Array ? 'Uint16' : T === Uint32Array ? 'Uint32' : T === Uint8Array ? 'Uint8' : 'Int16'}`
        ](i * n * T.BYTES_PER_ELEMENT + k * T.BYTES_PER_ELEMENT, true)
      )
  return out
}
const mul = (a, b) => {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      o[c * 4 + r] = s
    }
  return o
}
const xf = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
]
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** 某 GLB 内按材质名收集顶点的 ENU 坐标（含矩阵链） */
function collect(file, M, matRe) {
  const g = loadGLB(file)
  const pts = []
  for (const mesh of g.json.meshes ?? [])
    for (const prim of mesh.primitives ?? []) {
      const mname = g.json.materials?.[prim.material]?.name ?? ''
      if (!matRe.test(mname)) continue
      const pos = readAccessor(g, prim.attributes.POSITION)
      for (let i = 0; i < pos.length; i += 3) {
        const enu = xf(M, gltfToEnu(pos[i], pos[i + 1], pos[i + 2]))
        pts.push({ x: enu[0], z: enu[1], y: enu[2], m: mname })
      }
    }
  return pts
}

function walk(node, M, out) {
  const m = node.transform ? mul(M, node.transform) : M
  if (node.content?.uri) out.push({ uri: node.content.uri, M: m, name: node.extras?.name ?? '' })
  for (const c of node.children ?? []) walk(c, m, out)
}

const tileset = JSON.parse(fs.readFileSync(path.join(TILES, 'tileset.json'), 'utf8'))
const canalGLB = { file: path.join(CANAL, 'canal.glb'), M: I4 }
const cw = collect(canalGLB.file, I4, /canal-water/)
console.log(
  'canal-water 顶点数 = ' +
    cw.length +
    '，高度范围 ' +
    Math.min(...cw.map((p) => p.y)).toFixed(2) +
    ' ~ ' +
    Math.max(...cw.map((p) => p.y)).toFixed(2)
)

const hubs = (tileset.root.children ?? []).filter((c) => /枢纽/.test(c.extras?.name ?? ''))
for (const hub of hubs) {
  const Mh = hub.transform ? mul(I4, hub.transform) : I4
  const box = hub.boundingVolume.box
  const C = xf(Mh, [box[0], box[1], box[2]])
  const ax = [0, 1, 2].map((i) =>
    xf(Mh, [box[3 + 3 * i], box[4 + 3 * i], box[5 + 3 * i]]).map((v, j) => v - xf(Mh, [0, 0, 0])[j])
  )
  const half = ax.map((v, i) => Math.hypot(...v))
  const unit = ax.map((v) => v.map((x) => x / Math.hypot(...v)))
  const inside = (p) => {
    const d = [p.x - C[0], p.z - C[1], p.y - C[2]]
    for (let i = 0; i < 3; i++) {
      const t = d[0] * unit[i][0] + d[1] * unit[i][1] + d[2] * unit[i][2]
      if (Math.abs(t) > half[i]) return false
    }
    return true
  }
  // 运河带水面顶点落在枢纽盒内 → 穿盒段 + 重叠面积（按三角带近似：取落在盒内顶点覆盖的长度×带宽）
  const inHub = cw.filter(inside)
  // 沿盒主轴投影取跨度
  let span = 0
  if (inHub.length) {
    const proj = inHub.map((p) => {
      const d = [p.x - C[0], p.z - C[1], p.y - C[2]]
      return d[0] * unit[1][0] + d[1] * unit[1][1] + d[2] * unit[1][2] // 沿盒纵轴
    })
    span = Math.max(...proj) - Math.min(...proj)
  }
  // 枢纽自带水面
  const leaves = []
  walk(hub, I4, leaves) // walk 内部自行施加 hub.transform（Mh 已含一次，避免双重变换）
  let hw = []
  for (const l of leaves) hw = hw.concat(collect(path.join(TILES, l.uri), l.M, /water/i))
  const inHubHW = hw.filter(inside)
  const med = (arr) => {
    const s = [...arr].sort((a, b) => a - b)
    return s.length ? s[Math.floor(s.length / 2)] : NaN
  }
  // 沿盒纵轴（取半轴最大者为轴向）投影
  // 水平两轴中取较长者为沿运河轴，另一者为横向（竖直轴 half[2] 不参与）
  const axisIdx = half[0] >= half[1] ? 0 : 1
  const crossIdx = axisIdx === 0 ? 1 : 0
  const proj = (p) => {
    const d = [p.x - C[0], p.z - C[1], p.y - C[2]]
    return d[0] * unit[axisIdx][0] + d[1] * unit[axisIdx][1] + d[2] * unit[axisIdx][2]
  }
  const cross = (p) => {
    const d = [p.x - C[0], p.z - C[1], p.y - C[2]]
    return d[0] * unit[crossIdx][0] + d[1] * unit[crossIdx][1] + d[2] * unit[crossIdx][2]
  }
  const range = (arr, fn) =>
    arr.length ? [Math.min(...arr.map(fn)), Math.max(...arr.map(fn))] : [NaN, NaN]
  const [cLo, cHi] = range(inHub, cross)
  const [hLo, hHi] = range(inHubHW, cross)
  const [caLo, caHi] = range(inHub, proj)
  const [haLo, haHi] = range(inHubHW, proj)
  const ovLo = Math.max(cLo, hLo)
  const ovHi = Math.min(cHi, hHi)
  const sorted = [...inHub.map(proj)].sort((a, b) => a - b)
  const clusters = []
  for (const v of sorted) {
    if (!clusters.length || v - clusters[clusters.length - 1][1] > 60) clusters.push([v, v])
    else clusters[clusters.length - 1][1] = v
  }
  const spanOf = (arr) =>
    arr.length ? Math.max(...arr.map(proj)) - Math.min(...arr.map(proj)) : NaN
  // 运河带顶点到最近枢纽水面的 XY 距离（重叠判据：<30 m 视为重叠）
  const near = inHub.map((p) => {
    let best = Infinity
    for (const q of inHubHW) best = Math.min(best, Math.hypot(p.x - q.x, p.z - q.z))
    return best
  })
  const nearMed = near.length ? med(near) : NaN
  const fracNear = near.length ? near.filter((d) => d < 30).length / near.length : NaN
  console.log(
    `\n${hub.extras.name}: 盒半轴 ${half.map((h) => h.toFixed(0)).join('/')} m` +
      `\n  运河带水面在盒内: 顶点 ${inHub.length}/${cw.length}，沿盒长轴跨度 ${spanOf(inHub).toFixed(0)} m（带宽 120 m）` +
      `\n  枢纽自带水面(water+poolWater)在盒内: 顶点 ${inHubHW.length}，沿长轴跨度 ${spanOf(inHubHW).toFixed(0)} m` +
      `\n  运河带顶点到枢纽水面 XY 最近距离: 中位 ${nearMed.toFixed(1)} m；<30 m 占比 ${(fracNear * 100).toFixed(1)}%` +
      `\n  横轴（短轴）位置: 带 [${cLo.toFixed(0)}, ${cHi.toFixed(0)}] ｜ 枢纽水 [${hLo.toFixed(0)}, ${hHi.toFixed(0)}] ⇒ 横向重叠 ${ovHi > ovLo ? (ovHi - ovLo).toFixed(0) + ' m' : '0（错开）'}` +
      `\n  沿轴范围: 带 [${caLo.toFixed(0)}, ${caHi.toFixed(0)}] ｜ 枢纽水 [${haLo.toFixed(0)}, ${haHi.toFixed(0)}]` +
      `\n  带子簇: ${clusters.length ? clusters.map((c) => '[' + c[0].toFixed(0) + ',' + c[1].toFixed(0) + ']').join(' ') : '无'}` +
      `\n  盒内运河带水面高度: 中位 ${med(inHub.map((p) => p.y)).toFixed(2)} m（${inHub.length ? Math.min(...inHub.map((p) => p.y)).toFixed(2) : '-'} ~ ${inHub.length ? Math.max(...inHub.map((p) => p.y)).toFixed(2) : '-'}）` +
      `\n  枢纽自带水面: 顶点 ${inHubHW.length}，高度中位 ${med(inHubHW.map((p) => p.y)).toFixed(2)} m` +
      `\n  带水 − 枢纽水（中位差）: ${(med(inHub.map((p) => p.y)) - med(inHubHW.map((p) => p.y))).toFixed(2)} m`
  )
}
