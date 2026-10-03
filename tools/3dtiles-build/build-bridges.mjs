#!/usr/bin/env node
/**
 * 城区跨江桥参数化重建。
 *
 * ## 为什么重建
 *
 * 交付包里的 bridges-up / bridges-mid / bridges-urban **不是桥**——实测是
 * 半轴 12×15 km / 6×13 km / 1.5×4.9 km 的走廊条（.local/3d-diag/bridges.cjs）。
 * 用户原话：「钦州新建的几座桥，位置没对齐，而且桥也不行，桥也得单独建模」。
 *
 * ## 数据来源与边界
 *
 * 桥位与长度取自 OSM（Overpass：way["bridge"] 钦州城区），**桥型与跨径来自公开
 * 资料**（子材大桥主跨 270 m / 净高 19.3 m / 桥面宽 40 m；其余按梁桥处理）。
 * 这是**参数化还原**，不是实测几何——写进 extras 供下游辨别。
 *
 * 一桥（南珠大桥 / 南珠大街跨江桥）OSM 无 bridge 标签，本脚本不含；
 * 其官方名在 2025 年命名批复里也存疑（批复「市区内 6 座」列的是「钦江大桥」）。
 *
 * 用法：node tools/3dtiles-build/build-bridges.mjs [--osm 文件] [--out 目录]
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildGLB, box, enuNormalToGltf, enuToGltf, gltfToEnu } from './glb.mjs'

/** 城区桥清单：名称 → OSM way id 列表（多段同名 way 取并集，用其几何端点定轴向） */
export const CITY_BRIDGES = [
  {
    key: 'jinhaiwan',
    name: '金海湾大桥',
    aka: '钦江三桥',
    ways: [311201482, 395666087],
    deckW: 40,
    towers: 0,
  },
  { key: 'qinjiang', name: '钦江大桥', aka: '', ways: [311201402], deckW: 24, towers: 0 },
  {
    key: 'zicai',
    name: '子材大桥',
    aka: '钦江四桥',
    ways: [311200699, 395668225, 395668231],
    deckW: 40,
    towers: 2,
    mainSpan: 270,
    clearH: 19.3,
  },
  { key: 'yongfu', name: '永福大桥', aka: '钦江二桥', ways: [395668243], deckW: 24, towers: 0 },
  { key: 'minchang', name: '敏昌大桥', aka: '钦江五桥', ways: [], deckW: 30, towers: 0 },
]

const A = 6378137.0,
  F = 1 / 298.257223563,
  E2 = F * (2 - F)
function ecef(lng, lat, h) {
  const L = (lng * Math.PI) / 180,
    B = (lat * Math.PI) / 180
  const N = A / Math.sqrt(1 - E2 * Math.sin(B) ** 2)
  return [
    (N + h) * Math.cos(B) * Math.cos(L),
    (N + h) * Math.cos(B) * Math.sin(L),
    (N * (1 - E2) + h) * Math.sin(B),
  ]
}
/** 以锚点建 ENU 旋转 + 平移（与交付包同款列优先 4×4） */
export function enuTransform(lng, lat, h = 0) {
  const L = (lng * Math.PI) / 180,
    B = (lat * Math.PI) / 180
  const sL = Math.sin(L),
    cL = Math.cos(L),
    sB = Math.sin(B),
    cB = Math.cos(B)
  const east = [-sL, cL, 0]
  const north = [-sB * cL, -sB * sL, cB]
  const up = [cB * cL, cB * sL, sB]
  const o = ecef(lng, lat, h)
  return [
    east[0],
    east[1],
    east[2],
    0,
    north[0],
    north[1],
    north[2],
    0,
    up[0],
    up[1],
    up[2],
    0,
    o[0],
    o[1],
    o[2],
    1,
  ]
}

function collectWays(osm, ids) {
  const set = new Set(ids)
  return osm.elements.filter((e) => set.has(e.id) && (e.geometry ?? []).length >= 2)
}

/** 一座桥的三角面：桥面 + 桥墩 + 栏杆（+ 可选双塔） */
export function buildBridge(wayGeoms, spec, toLocal) {
  const positions = [],
    normals = [],
    colors = []
  const addBox = (cx, cy, cz, sx, sy, sz, color, rotY = 0) => {
    const g = box(sx, sy, sz)
    const ca = Math.cos(rotY),
      sa = Math.sin(rotY)
    const base = positions.length / 3
    for (let i = 0; i < g.positions.length; i += 3) {
      const x = g.positions[i],
        y = g.positions[i + 1],
        z = g.positions[i + 2]
      // box() 出来的是 glTF Y-up（Y=高）；这里 x/z 是水平轴、y 是高度 ⇒ 先还原 ENU 再过 enuToGltf。
      // 直通 ENU 会让桥按 N（城区 N≈-2.7 km）整个挪走/下沉。
      positions.push(...enuToGltf(cx + x * ca - z * sa, cy + x * sa + z * ca, cz + y))
      normals.push(
        ...enuNormalToGltf(
          g.normals[i] * ca - g.normals[i + 2] * sa,
          g.normals[i] * sa + g.normals[i + 2] * ca,
          g.normals[i + 1]
        )
      )
      colors.push(color[0], color[1], color[2])
    }
    for (let i = 0; i < g.indices.length; i++) void g.indices[i]
    return { base, indices: g.indices }
  }
  const indices = []
  const emit = (cx, cy, cz, sx, sy, sz, color, rotY = 0) => {
    const r = addBox(cx, cy, cz, sx, sy, sz, color, rotY)
    for (let i = 0; i < r.indices.length; i++) indices.push(r.indices[i] + r.base)
  }
  const DECK = [0.72, 0.72, 0.74],
    PIER = [0.55, 0.55, 0.57],
    RAIL = [0.35, 0.42, 0.55],
    TOWER = [0.8, 0.78, 0.72]

  let spans = 0
  for (const g of wayGeoms) {
    const pts = g.geometry.map((p) => toLocal(p.lon, p.lat))
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i],
        [x1, y1] = pts[i + 1]
      const dx = x1 - x0,
        dy = y1 - y0
      const len = Math.hypot(dx, dy)
      if (len < 5) continue
      spans++
      const cx = (x0 + x1) / 2,
        cy = (y0 + y1) / 2
      const rotY = Math.atan2(dy, dx)
      // 桥面（厚 2.5 m，顶面在 u=22 即通航净高之上）
      emit(cx, cy, 22 - 1.25, len, 2.5, spec.deckW, DECK, rotY)
      // 栏杆（两侧，高 1.2 m）
      const hw = spec.deckW / 2
      for (const s of [1, -1]) {
        const ox = -Math.sin(rotY) * hw * s,
          oy = Math.cos(rotY) * hw * s
        emit(cx + ox, cy + oy, 22 + 0.6, len, 1.2, 0.35, RAIL, rotY)
      }
      // 桥墩（每段中点一个，直径 2.5 m）
      emit(cx, cy, 22 - 2.5 - 11, 2.5, 22, 2.5, PIER, rotY)
      // 双塔（子材大桥）
      if (spec.towers) {
        for (const e of [0, 1]) {
          const t = e === 0 ? pts[i] : pts[i + 1]
          for (const s of [1, -1]) {
            const ox = -Math.sin(rotY) * hw * s,
              oy = Math.cos(rotY) * hw * s
            emit(t[0] + ox, t[1] + oy, 22 + 26, 3, 52, 3, TOWER, rotY)
          }
        }
      }
    }
  }
  return { positions, normals, colors, indices, spans }
}

export function buildAll({ osmFile, outDir }) {
  const osm = JSON.parse(fs.readFileSync(osmFile, 'utf8'))
  const all = osm.elements.filter((e) => (e.geometry ?? []).length >= 2)
  // 以子材大桥中点为锚建局部 ENU
  const anchorWay = all.find((e) => e.tags?.name === '子材大桥')
  const ag = anchorWay.geometry[Math.floor(anchorWay.geometry.length / 2)]
  const T = enuTransform(ag.lon, ag.lat)
  const R = [T[0], T[1], T[2], T[4], T[5], T[6], T[8], T[9], T[10]]
  const O = [T[12], T[13], T[14]]
  const toLocal = (lng, lat, h = 0) => {
    const P = ecef(lng, lat, h)
    const d = [P[0] - O[0], P[1] - O[1], P[2] - O[2]]
    return [
      R[0] * d[0] + R[1] * d[1] + R[2] * d[2],
      R[3] * d[0] + R[4] * d[1] + R[5] * d[2],
      R[6] * d[0] + R[7] * d[1] + R[8] * d[2],
    ]
  }

  // 按名字归并 way
  const byName = new Map()
  for (const e of all) {
    const n = e.tags?.name
    if (!n || !e.tags?.bridge || e.tags.bridge === 'no') continue
    if (!byName.has(n)) byName.set(n, [])
    byName.get(n).push(e)
  }

  fs.mkdirSync(outDir, { recursive: true })
  const meshes = [],
    materials = [],
    nodes = [],
    children = []
  let mi = 0
  const built = []
  for (const spec of CITY_BRIDGES) {
    const ways = byName.get(spec.name) ?? []
    if (!ways.length) {
      built.push({ ...spec, spans: 0, note: 'OSM 无此桥' })
      continue
    }
    const g = buildBridge(ways, spec, toLocal)
    if (!g.indices.length) {
      built.push({ ...spec, spans: 0, note: '几何为空' })
      continue
    }
    let mn = [Infinity, Infinity, Infinity],
      mx = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < g.positions.length; i += 3)
      for (let c = 0; c < 3; c++) {
        const v = g.positions[i + c]
        if (v < mn[c]) mn[c] = v
        if (v > mx[c]) mx[c] = v
      }
    const uri = spec.key + '.glb'
    fs.writeFileSync(
      path.join(outDir, uri),
      buildGLB({
        meshes: [
          {
            primitives: [
              {
                positions: g.positions,
                normals: g.normals,
                colors: g.colors,
                indices: g.indices,
                material: mi,
              },
            ],
          },
        ],
        materials: [
          {
            name: spec.key,
            pbrMetallicRoughness: {
              baseColorFactor: [1, 1, 1, 1],
              metallicFactor: 0.2,
              roughnessFactor: 0.8,
            },
          },
        ],
        nodes: [{ mesh: 0 }],
      })
    )
    // positions 是 glTF Y-up，boundingVolume 必须是 tile 局部 **ENU(Z-up)**：轴序混用会把
    // 整桥挪到别处（实测桥位包围盒中心比真实低 ~150 m、北向塌到 35 m）⇒ 近机位整层被剔除
    // （statistics.visited=0，桥在自己的位置上看不见），远机位视锥大才偶尔选中。
    const gCenter = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2]
    const gHalf = [(mx[0] - mn[0]) / 2 + 5, (mx[1] - mn[1]) / 2 + 5, (mx[2] - mn[2]) / 2 + 5]
    const c0 = gltfToEnu(gCenter[0], gCenter[1], gCenter[2])
    const h0 = [gHalf[0], gHalf[2], gHalf[1]]
    children.push({
      boundingVolume: { box: [c0[0], c0[1], c0[2], h0[0], 0, 0, 0, h0[1], 0, 0, 0, h0[2]] },
      geometricError: 0,
      refine: 'ADD',
      content: { uri },
      extras: {
        name: spec.name,
        aka: spec.aka,
        spans: g.spans,
        triangles: g.indices.length / 3,
        reconstruction: '参数化还原（OSM 桥位 + 公开资料桥型），非实测几何',
      },
    })
    mi++
    built.push({ ...spec, spans: g.spans, tris: g.indices.length / 3 })
  }
  let mn = [Infinity, Infinity, Infinity],
    mx = [-Infinity, -Infinity, -Infinity]
  for (const c of children) {
    const b = c.boundingVolume.box
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], b[k] - b[3 + k * 4])
      mx[k] = Math.max(mx[k], b[k] + b[3 + k * 4])
    }
  }
  const tileset = {
    asset: { version: '1.1', generator: 'beibu-3dtiles-build/build-bridges' },
    geometricError: 2048,
    root: {
      transform: T,
      boundingVolume: {
        box: [
          (mn[0] + mx[0]) / 2,
          (mn[1] + mx[1]) / 2,
          (mn[2] + mx[2]) / 2,
          (mx[0] - mn[0]) / 2 + 50,
          0,
          0,
          0,
          (mx[1] - mn[1]) / 2 + 50,
          0,
          0,
          0,
          (mx[2] - mn[2]) / 2 + 50,
        ],
      },
      geometricError: 1024,
      refine: 'ADD',
      children,
    },
  }
  fs.writeFileSync(path.join(outDir, 'tileset.json'), JSON.stringify(tileset))
  return { built, anchor: { lng: ag.lon, lat: ag.lat }, count: children.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(k)
    return i > 0 ? process.argv[i + 1] : d
  }
  const r = buildAll({
    osmFile: arg('--osm', '.local/3d-diag/bridges-osm.json'),
    outDir: arg('--out', 'backend/static/bridges-city'),
  })
  console.log(
    '锚点 ' + r.anchor.lat.toFixed(5) + ',' + r.anchor.lng.toFixed(5) + '  建成 ' + r.count + ' 座'
  )
  for (const b of r.built) {
    console.log(
      '  ' +
        b.name.padEnd(8) +
        String(b.aka).padEnd(8) +
        ' 段' +
        String(b.spans).padStart(2) +
        (b.tris ? '  ' + b.tris + ' 面' : '  ' + (b.note ?? ''))
    )
  }
}
