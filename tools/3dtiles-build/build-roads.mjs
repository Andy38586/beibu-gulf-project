#!/usr/bin/env node
/**
 * 作业区道路：OSM 中心线 → 挤出路面。
 *
 * ## 数据来源
 *
 * Overpass API：way["highway"](21.650,108.610,21.705,108.675)，实测 92 条 / 846 点，
 * 类型 service 67 / unclassified 15 / tertiary 8 / secondary 2，**全部无名字**
 * （港口作业区内部道路，OSM 上未命名）。
 *
 * ## 落位
 *
 * 与钦州港交付包**同一 root.transform**，故与集装箱层逐位对齐。
 * 高程取交付包里箱区底面（即地面），由容器层的 cell 包围盒反算——
 * 不用 0：局部 ENU 的 u=0 是 root 原点高度，不是地面，直接铺会在空中或地下。
 *
 * ## 宽度
 *
 * 按 OSM highway 等级取车道宽（不是量测值，是**类型默认值**）：
 * secondary 12 / tertiary 9 / unclassified 7 / service 5 米。
 *
 * 用法：node tools/3dtiles-build/build-roads.mjs [--osm 文件] [--out 目录]
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildGLB, enuToGltf, GLTF_UP, gltfToEnu } from './glb.mjs'
import { heightsOfMaterial, median, readGLB } from './glb-read.mjs'

const TILE_DIR = 'backend/static/qinzhou-port/tiles'
/** 与 qinzhou-port 交付包同一 root.transform（落位逐位对齐的前提） */
function rootTransform(tileDir = TILE_DIR) {
  const ts = JSON.parse(fs.readFileSync(path.join(tileDir, 'tileset.json'), 'utf8'))
  return ts.root.transform
}
const WIDTH = { secondary: 12, tertiary: 9, unclassified: 7, service: 5 }
const DEFAULT_WIDTH = 6
const ROAD_LIFT = 0.15

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
export function makeToLocal(T) {
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

/**
 * 作业区**地面高程基准** u₀（米，交付包 ENU 的 u）——全项目唯一一处定义。
 *
 * ## 为什么改（2026-10-04）
 * 旧实现读 rebuilt/tileset.json 里**切块包围盒的底**（−20.35）。切块是**空间分桶**，
 * 盒底由分桶网格决定、与地面无关：实测它比真实场地低 **4.7 m**，于是路网整层埋在
 * 交付包表面之下、只在没有几何的地方露头——用户原话「路不平，有缝隙」。
 *
 * ## 新口径：从**交付包自己的几何**派生
 * 轨道（rail，铺在场面上）与混凝土（concrete）是两个独立材质，实测中位 −15.52 / −15.54，
 * 一致到 0.02 m ⇒ 取二者中位的中位数作基准。**交付包换版必须重算**（本函数每次现算，不缓存）。
 *
 * 缺交付包时**报错**而不是静默返回 0：返回 0 会让整层挪到天空里且不报错。
 */
export function groundLevel(tileDir = 'backend/static/qinzhou-port/tiles') {
  const rail = [],
    concrete = []
  const files = fs.readdirSync(tileDir).filter((f) => /^t[45]_.*\.glb$/.test(f))
  if (!files.length) throw new Error('地面基准：' + tileDir + ' 里没有 t4/t5 细瓦片，无法派生 u₀')
  for (const f of files) {
    const { json, bin } = readGLB(path.join(tileDir, f))
    rail.push(...heightsOfMaterial(json, bin, 'rail'))
    concrete.push(...heightsOfMaterial(json, bin, 'concrete'))
  }
  const u = (median(rail) + median(concrete)) / 2
  if (!Number.isFinite(u) || u < -40 || u > 0) {
    throw new Error(
      '地面基准越界: ' +
        u +
        '（rail 中位 ' +
        median(rail) +
        ' / concrete 中位 ' +
        median(concrete) +
        '）'
    )
  }
  return u
}

/** 把一条 way 挤出成路面（三角面 + 法线） */
export function extrudeWay(pts, width, groundU, lift) {
  const hw = width / 2
  const positions = [],
    normals = [],
    indices = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i],
      [x1, y1] = pts[i + 1]
    const dx = x1 - x0,
      dy = y1 - y0
    const len = Math.hypot(dx, dy)
    if (len < 0.5) continue
    const nx = (-dy / len) * hw,
      ny = (dx / len) * hw
    const u = groundU + lift
    const base = positions.length / 3
    // 四个角先算 ENU，再统一过 enuToGltf——直通 ENU 会让整层按 N 抬高（见 glb.mjs 注释）
    for (const [ee, nn] of [
      [x0 + nx, y0 + ny],
      [x1 + nx, y1 + ny],
      [x1 - nx, y1 - ny],
      [x0 - nx, y0 - ny],
    ]) {
      positions.push(...enuToGltf(ee, nn, u))
    }
    for (let k = 0; k < 4; k++) normals.push(...GLTF_UP)
    // 绕序必须让几何法线朝 +Y（= 声明的 GLTF_UP）：按 A,B,C,D 直连会**从上方看是顺时针**，
    // 在 Cesium 默认 backFaceCulling 下整层被剔除——不报错、不缺瓦片、包围盒照旧，
    // 只是**一个像素都不画**（2026-10-04 实测：港区道路层画面贡献 0.00%，
    // 人为关掉剔除后 2.71%）。同族正确写法见 build-ground.mjs:110-111。
    // 判据：__tests__/build.test.mjs「绕序」两条（删本条注释下的索引顺序即必红）。
    indices.push(base + 3, base + 2, base, base + 2, base + 1, base)
  }
  return { positions, normals, indices }
}

export function buildRoads({ osmFile, outDir, rebuiltDir, tileDir = TILE_DIR }) {
  const osm = JSON.parse(fs.readFileSync(osmFile, 'utf8'))
  const T = rootTransform(tileDir)
  const toLocal = makeToLocal(T)
  // 地面基准从**交付包几何**派生（见 groundLevel 注释）；rebuiltDir 不再参与高程决策
  const groundU = groundLevel(tileDir)
  const buckets = new Map()
  let ways = 0,
    segs = 0
  for (const el of osm.elements) {
    const geom = el.geometry ?? []
    if (geom.length < 2) continue
    const kind = el.tags?.highway ?? 'service'
    const width = WIDTH[kind] ?? DEFAULT_WIDTH
    const pts = geom.map((g) => {
      const [e, n] = toLocal(g.lon, g.lat)
      return [e, n]
    })
    const geo = extrudeWay(pts, width, groundU, ROAD_LIFT)
    if (!geo.indices.length) continue
    ways++
    segs += geo.indices.length / 6
    if (!buckets.has(kind))
      buckets.set(kind, { positions: [], normals: [], indices: [], color: null })
    const b = buckets.get(kind)
    const base = b.positions.length / 3
    for (let i = 0; i < geo.positions.length; i++) b.positions.push(geo.positions[i])
    for (let i = 0; i < geo.normals.length; i++) b.normals.push(geo.normals[i])
    for (let i = 0; i < geo.indices.length; i++) b.indices.push(geo.indices[i] + base)
  }

  // 道路等级 → 颜色（主干更亮）
  const TONE = {
    secondary: [0.42, 0.42, 0.44],
    tertiary: [0.36, 0.36, 0.38],
    unclassified: [0.3, 0.3, 0.32],
    service: [0.24, 0.24, 0.26],
  }
  const meshes = [],
    materials = [],
    nodes = []
  let i = 0
  for (const [kind, b] of [...buckets.entries()].sort()) {
    const tone = TONE[kind] ?? [0.3, 0.3, 0.3]
    const colors = []
    for (let k = 0; k < b.positions.length / 3; k++) colors.push(tone[0], tone[1], tone[2])
    meshes.push({
      primitives: [
        { positions: b.positions, normals: b.normals, colors, indices: b.indices, material: i },
      ],
    })
    materials.push({
      name: 'road-' + kind,
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0.0,
        roughnessFactor: 0.95,
      },
    })
    nodes.push({ mesh: i })
    i++
  }
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'roads.glb'), buildGLB({ meshes, materials, nodes }))

  const mn = [Infinity, Infinity, Infinity],
    mx = [-Infinity, -Infinity, -Infinity]
  for (const b of buckets.values()) {
    for (let k = 0; k < b.positions.length; k += 3) {
      for (let c = 0; c < 3; c++) {
        const v = b.positions[k + c]
        if (v < mn[c]) mn[c] = v
        if (v > mx[c]) mx[c] = v
      }
    }
  }
  // positions 是 glTF Y-up，但 boundingVolume 必须是 tile 局部 **ENU(Z-up)**。
  // 直接把 glTF 的 min/max 填进 box ⇒ 北向被当竖轴，包围盒落到椭球下 5.3 km，
  // Cesium 近机位整层剔除（visited=0，路网不显示）。故过 gltfToEnu 并把半轴按同一次
  // 轴置换重排：glTF(x,y,z)→ENU(x,−z,y) ⇒ 半轴 (hx,hy,hz)→(hx,hz,hy)。
  const gCenter = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2]
  const gHalf = [(mx[0] - mn[0]) / 2 + 5, (mx[1] - mn[1]) / 2 + 5, (mx[2] - mn[2]) / 2 + 5]
  const c0 = gltfToEnu(gCenter[0], gCenter[1], gCenter[2])
  const h0 = [gHalf[0], gHalf[2], gHalf[1]]
  const tileset = {
    asset: { version: '1.1', generator: 'beibu-3dtiles-build/build-roads' },
    geometricError: 512,
    root: {
      transform: T,
      boundingVolume: { box: [c0[0], c0[1], c0[2], h0[0], 0, 0, 0, h0[1], 0, 0, 0, h0[2]] },
      geometricError: 256,
      refine: 'ADD',
      content: { uri: 'roads.glb' },
      extras: { ways, segments: segs, groundU: Number(groundU.toFixed(2)) },
    },
  }
  fs.writeFileSync(path.join(outDir, 'tileset.json'), JSON.stringify(tileset))
  return {
    ways,
    segs,
    groundU,
    byKind: Object.fromEntries([...buckets].map(([k, b]) => [k, b.indices.length / 6])),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(k)
    return i > 0 ? process.argv[i + 1] : d
  }
  const r = buildRoads({
    osmFile: arg('--osm', '.local/3d-diag/roads.json'),
    outDir: arg('--out', 'backend/static/qinzhou-port/rebuilt/roads'),
    rebuiltDir: arg('--rebuilt', 'backend/static/qinzhou-port/rebuilt'),
  })
  console.log('道路 ' + r.ways + ' 条 / ' + r.segs + ' 段，地面 u=' + r.groundU.toFixed(2) + ' m')
  console.log('按等级: ' + JSON.stringify(r.byKind))
}
