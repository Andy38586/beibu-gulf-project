#!/usr/bin/env node
/**
 * 平陆运河全线重烘：OSM 中线 → **一条连续**的航道 + 两岸。
 *
 * ## 为什么重烘而不是平移走廊块
 *
 * 交付包把运河切成 11 个 corridor-* 块，实测块间接缝最大 6245 m（本机实测，
 * 见 docs/3dtiles-改造任务表.md §一 #9）——**它本来就是断的**。逐块平移只能
 * 把断点挪位置：枢纽按施工影像重锚后，马道枢纽偏离运河中线 248 m，走廊到
 * 枢纽角就断了（渲染图 .local/3d-diag/out-madao-diag.png 可见）。
 *
 * 一条从中线挤出的连续带没有这个问题：只要枢纽落在线附近（实测马道 248 /
 * 企石 99 / 青年 38 m），运河自然穿过枢纽。
 *
 * ## 断面（公开资料）
 *
 * 平陆运河按内河 I 级航道建设，**航道底宽 80 m**、水深 6.5 m、弯曲半径 ≥ 360 m；
 * 马道枢纽渠底 80 m（交付包 generator 字符串亦记「渠底 80 m」）。本脚本按
 * 「水面 120 m + 两岸各 60 m 堤顶」建模——水面宽取底宽加上边坡投影的估算，
 * **不是量测值**。
 *
 * 用法：node tools/3dtiles-build/build-canal.mjs [--osm 文件] [--out 目录]
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildGLB, enuToGltf, GLTF_UP } from './glb.mjs'

/** 与 pinglu 交付包同一 root.transform（落位逐位对齐的前提） */
const TILE_DIR = 'backend/static/pinglu/tiles'
/** 水面半宽 / 堤顶半宽（米） */
const WATER_HALF = 60
const BANK_HALF = 120
/** 水面高程与堤顶抬高（相对地面，米） */
const WATER_LIFT = 0.4
const BANK_LIFT = 1.2

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
function makeToEnu(T) {
  const R = [T[0], T[1], T[2], T[4], T[5], T[6], T[8], T[9], T[10]]
  const O = [T[12], T[13], T[14]]
  return (lng, lat, h = 0) => {
    const P = ecef(lng, lat, h)
    const d = [P[0] - O[0], P[1] - O[1], P[2] - O[2]]
    return [
      R[0] * d[0] + R[1] * d[1] + R[2] * d[2],
      R[3] * d[0] + R[4] * d[1] + R[5] * d[2],
      R[6] * d[0] + R[7] * d[1] + R[8] * d[2],
    ]
  }
}

/** 把中线折线按 ~40 m 稠密化 */
export function densify(pts, step = 40) {
  const out = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i],
      [x1, y1] = pts[i + 1]
    const d = Math.hypot(x1 - x0, y1 - y0)
    const n = Math.max(1, Math.ceil(d / step))
    for (let k = 0; k < n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n])
  }
  if (pts.length) out.push(pts[pts.length - 1])
  return out
}

/**
 * 沿稠密折线挤出一条带。
 *
 * `offset` 是**带的中心线相对运河中线的横向偏移**（米）：堤顶要画成左右两条侧带，
 * 否则一条全宽带会盖住水面——第一版就是这样，渲染出来只看得到堤、看不到水。
 */
export function ribbon(pts, halfW, lift, color, groundU = 0, offset = 0) {
  const positions = [],
    normals = [],
    colors = [],
    indices = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i],
      [x1, y1] = pts[i + 1]
    const dx = x1 - x0,
      dy = y1 - y0
    const len = Math.hypot(dx, dy)
    if (len < 0.5) continue
    const ux = -dy / len,
      uy = dx / len
    const ox = ux * offset,
      oy = uy * offset
    const nx = ux * halfW,
      ny = uy * halfW
    const u = groundU + lift
    const base = positions.length / 3
    // 同 build-roads：ENU 必须过 enuToGltf，直通会把整条运河抬到 N（实测最高 49 km）
    for (const [ee, nn] of [
      [x0 + ox + nx, y0 + oy + ny],
      [x1 + ox + nx, y1 + oy + ny],
      [x1 + ox - nx, y1 + oy - ny],
      [x0 + ox - nx, y0 + oy - ny],
    ]) {
      positions.push(...enuToGltf(ee, nn, u))
    }
    for (let k = 0; k < 4; k++) {
      normals.push(...GLTF_UP)
      colors.push(color[0], color[1], color[2])
    }
    // 绕序同 build-roads：直连 A,B,C,D 会让几何法线朝 −Y（从上方看顺时针）⇒ Cesium 默认
    // backFaceCulling 下整条运河带不可见（2026-10-04 实测：马道机位开剔除只见枢纽 6.71%，
    // 关掉剔除后 12.18%，差的 5.5% 就是这条带）。正确写法见 build-ground.mjs:110-111。
    indices.push(base + 3, base + 2, base, base + 2, base + 1, base)
  }
  return { positions, normals, colors, indices }
}

/** 从交付包读出三个枢纽的中心（局部 ENU）——它们是**按施工影像校准过**的点 */
export function hubTargets(tileDir) {
  const ts = JSON.parse(fs.readFileSync(path.join(tileDir, 'tileset.json'), 'utf8'))
  const T = ts.root.transform
  const R = [T[0], T[1], T[2], T[4], T[5], T[6], T[8], T[9], T[10]]
  const O = [T[12], T[13], T[14]]
  const out = []
  for (const c of ts.root.children ?? []) {
    const nm = String(c.extras?.name ?? c.extras?.tile ?? '')
    if (!/枢纽/.test(nm)) continue
    const local = c.transform ? mat4mul(T, c.transform) : T
    const b = c.boundingVolume?.box
    if (!b) continue
    const P = applyMat(local, [b[0], b[1], b[2]])
    const d = [P[0] - O[0], P[1] - O[1], P[2] - O[2]]
    out.push({
      name: nm,
      e: R[0] * d[0] + R[1] * d[1] + R[2] * d[2],
      n: R[3] * d[0] + R[4] * d[1] + R[5] * d[2],
    })
  }
  return out
}
function mat4mul(a, b) {
  const o = new Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      o[c * 4 + r] = s
    }
  return o
}
function applyMat(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ]
}

/**
 * 把中线在**枢纽附近局部拉过去**，使运河穿过枢纽。
 *
 * 为什么需要：OSM 的运河中线是**近似**的——平陆运河 2023–2026 才建成，
 * 实测马道枢纽（按施工影像校准）偏离 OSM 中线 **248 m**（企石 99 / 青年 38）。
 * 整条平移会把别处弄错；此处按距离做平方衰减的局部扭曲，衰减半径 2 km：
 * 枢纽点上位移权重 = 1（运河正好穿过），2 km 外不受影响。
 *
 * **失效条件**：若 OSM 日后按实建线路更新，本扭曲会重复施加——届时应先
 * 复测三个枢纽到中线的距离，若均 < 20 m 则本步可删。
 */
export function warpToHubs(pts, hubs, radius = 2000) {
  return pts.map(([x, y]) => {
    let dx = 0,
      dy = 0
    for (const h of hubs) {
      const d = Math.hypot(h.e - x, h.n - y)
      if (d >= radius) continue
      const w = (1 - d / radius) ** 2
      dx += w * (h.e - x)
      dy += w * (h.n - y)
    }
    return [x + dx, y + dy]
  })
}

export function buildCanal({ osmFile, outDir, groundU = 0 }) {
  const rel = JSON.parse(fs.readFileSync(osmFile, 'utf8'))
  const ts = JSON.parse(fs.readFileSync(path.join(TILE_DIR, 'tileset.json'), 'utf8'))
  const toEnu = makeToEnu(ts.root.transform)

  // relation 17958090 的 members[].geometry 就是全线中线；按 way 顺序拼成折线
  const segs = []
  for (const m of rel.elements[0].members ?? []) {
    const g = m.geometry ?? []
    if (g.length >= 2)
      segs.push(
        g.map((p) => {
          const [e, n] = toEnu(p.lon, p.lat)
          return [e, n]
        })
      )
  }
  if (!segs.length) throw new Error('中线为空')
  // 拼成**多条**链：OSM 的 members 里含主航道与支汊，一条链接不完。
  // 单链版本实测只接上 1 段（22 km，全线 134 km）——漏掉的全线都不会渲染。
  const chains = []
  const rest = segs.slice()
  while (rest.length) {
    const chain = [rest.shift()]
    let guard = 0
    while (rest.length && guard++ < segs.length * 2) {
      const tail = chain[chain.length - 1]
      const end = tail[tail.length - 1]
      let bi = -1,
        bd = Infinity,
        brev = false
      for (let i = 0; i < rest.length; i++) {
        const s = rest[i]
        for (const rev of [false, true]) {
          const p = rev ? s[s.length - 1] : s[0]
          const d = Math.hypot(p[0] - end[0], p[1] - end[1])
          if (d < bd) {
            bd = d
            bi = i
            brev = rev
          }
        }
      }
      if (bi < 0 || bd > 500) break
      const s = rest.splice(bi, 1)[0]
      chain.push(brev ? [...s].reverse() : s)
    }
    chains.push(chain.flat())
  }
  const hubs = hubTargets(TILE_DIR)
  const centerline = warpToHubs(
    chains.flatMap((c) => densify(c, 40)),
    hubs
  )

  const meshes = [],
    materials = [],
    nodes = []
  // 堤顶 = 水面两侧各一条侧带（不是全宽带——全宽会盖住水面）
  const BANK_W = BANK_HALF - WATER_HALF
  const parts = [
    {
      name: 'canal-bank-l',
      half: BANK_W / 2,
      lift: BANK_LIFT,
      color: [0.42, 0.38, 0.3],
      offset: WATER_HALF + BANK_W / 2,
    },
    {
      name: 'canal-bank-r',
      half: BANK_W / 2,
      lift: BANK_LIFT,
      color: [0.42, 0.38, 0.3],
      offset: -(WATER_HALF + BANK_W / 2),
    },
    {
      name: 'canal-water',
      half: WATER_HALF,
      lift: WATER_LIFT,
      color: [0.11, 0.28, 0.46],
      offset: 0,
    },
  ]
  let tris = 0
  parts.forEach((p, i) => {
    const g = ribbon(centerline, p.half, p.lift, p.color, groundU, p.offset)
    meshes.push({
      primitives: [
        {
          positions: g.positions,
          normals: g.normals,
          colors: g.colors,
          indices: g.indices,
          material: i,
        },
      ],
    })
    materials.push({
      name: p.name,
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0.0,
        roughnessFactor: 0.9,
      },
    })
    nodes.push({ mesh: i })
    tris += g.indices.length / 3
  })
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'canal.glb'), buildGLB({ meshes, materials, nodes }))

  const mn = [Infinity, Infinity, Infinity],
    mx = [-Infinity, -Infinity, -Infinity]
  for (const p of centerline) {
    for (const [k, v] of [
      [0, p[0] - BANK_HALF],
      [0, p[0] + BANK_HALF],
      [1, p[1] - BANK_HALF],
      [1, p[1] + BANK_HALF],
    ]) {
      if (v < mn[k]) mn[k] = v
      if (v > mx[k]) mx[k] = v
    }
  }
  mn[2] = groundU - 5
  mx[2] = groundU + BANK_LIFT + 5
  const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2]
  const h = [(mx[0] - mn[0]) / 2 + 20, (mx[1] - mn[1]) / 2 + 20, (mx[2] - mn[2]) / 2 + 5]
  const tileset = {
    asset: { version: '1.1', generator: 'beibu-3dtiles-build/build-canal' },
    geometricError: 8192,
    root: {
      transform: ts.root.transform,
      boundingVolume: { box: [c[0], c[1], c[2], h[0], 0, 0, 0, h[1], 0, 0, 0, h[2]] },
      geometricError: 4096,
      refine: 'ADD',
      content: { uri: 'canal.glb' },
      extras: {
        chains: chains.length,
        segments: chains.length,
        centerlinePoints: centerline.length,
        section: '水面 120 m + 两岸各 60 m（按底宽 80 m + 边坡估算，非量测）',
        reconstruction: '按 OSM 中线挤出，断面为参数化取值',
      },
    },
  }
  fs.writeFileSync(path.join(outDir, 'tileset.json'), JSON.stringify(tileset))
  return { segments: chains.length, points: centerline.length, tris, groundU, hubs }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(k)
    return i > 0 ? process.argv[i + 1] : d
  }
  const r = buildCanal({
    osmFile: arg('--osm', '.local/926-rebake/osm_canal.json'),
    outDir: arg('--out', 'backend/static/pinglu/canal'),
    groundU: Number(arg('--ground', '0')),
  })
  console.log('中线 ' + r.segments + ' 链 → 稠密 ' + r.points + ' 点；挤出 ' + r.tris + ' 三角面')
  console.log('已按枢纽局部扭曲: ' + r.hubs.map((h) => h.name).join(' / '))
  console.log('写出 ' + arg('--out', 'backend/static/pinglu/canal'))
}
