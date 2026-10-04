#!/usr/bin/env node
/**
 * B10 边界同域性：自建地面面片的边界，与影像范围 / 道路几何 / 集装箱 / 交付包内容
 * 是否落在同一域。只读，不改任何产物。
 *
 * ## 为什么需要
 * 台账 B10「地面单色未贴纹理 / 面片 bbox 直边」长期记为"硬缝"现象，但没人量过
 * 「面片边界 vs 影像范围」是否同域：若边界就是影像 bbox，则属自建片的设计范围边界，
 * 不是渲染没正位；若边界落在影像内部或外部，才是缺陷。
 *
 * ## 口径
 * 全部换算到交付包 root.transform 的 ENU 帧（x=东, y=北, z=天）：
 * ① 地面网格由 imagery.json 的 bbox 直接派生 ⇒ 用地面 GLB 的 accessor AABB 复核；
 * ② 道路用 roads.glb 的 accessor AABB + OSM 源（.local/3d-diag/roads.json）逐段长度；
 * ③ 集装箱/交付包用 tileset 盒 8 角点 × 逐层 transform；④ 经纬度用 WGS84 正反算。
 *
 * ## 数据前提（均 gitignored，本机资产）
 * - backend/static/qinzhou-port/{tiles,rebuilt,imagery}/…
 * - .local/3d-diag/roads.json（OSM Overpass 原始件；缺件时道路长度一节 SKIP）
 *
 * 用法：node tools/diag/probe-ground-boundary.mjs
 * 2026-10-05 实测：地面 GLB AABB 与 imagery bbox 逐位相同；道路 90.3% 长度在片外。
 */
import fs from 'node:fs'
import path from 'node:path'
import { readGLB } from '../3dtiles-build/glb-read.mjs'

const A = 6378137.0
const F = 1 / 298.257223563
const E2 = F * (2 - F)
const D2R = Math.PI / 180
const R2D = 180 / Math.PI

function geoToEcef(lon, lat, h = 0) {
  const L = lon * D2R
  const B = lat * D2R
  const N = A / Math.sqrt(1 - E2 * Math.sin(B) ** 2)
  return [
    (N + h) * Math.cos(B) * Math.cos(L),
    (N + h) * Math.cos(B) * Math.sin(L),
    (N * (1 - E2) + h) * Math.sin(B),
  ]
}

function ecefToGeo(x, y, z) {
  const lon = Math.atan2(y, x)
  const p = Math.hypot(x, y)
  let lat = Math.atan2(z, p * (1 - E2))
  let h = 0
  for (let i = 0; i < 12; i++) {
    const sp = Math.sin(lat)
    const cp = Math.cos(lat)
    const N = A / Math.sqrt(1 - E2 * sp * sp)
    h = p / cp - N
    lat = Math.atan2(z, p * (1 - (E2 * N) / (N + h)))
  }
  return { lon: lon * R2D, lat: lat * R2D, h }
}

const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function mul(a, b) {
  const r = new Array(16)
  for (let c = 0; c < 4; c++)
    for (let row = 0; row < 4; row++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[c * 4 + k]
      r[c * 4 + row] = s
    }
  return r
}

function xf(T, p) {
  return [
    T[0] * p[0] + T[4] * p[1] + T[8] * p[2] + T[12],
    T[1] * p[0] + T[5] * p[1] + T[9] * p[2] + T[13],
    T[2] * p[0] + T[6] * p[1] + T[10] * p[2] + T[14],
  ]
}

function boxCorners(b) {
  const [cx, cy, cz] = b
  const ax = [b[3], b[4], b[5]]
  const ay = [b[6], b[7], b[8]]
  const az = [b[9], b[10], b[11]]
  const out = []
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1])
        out.push([
          cx + sx * ax[0] + sy * ay[0] + sz * az[0],
          cy + sx * ax[1] + sy * ay[1] + sz * az[1],
          cz + sx * ax[2] + sy * ay[2] + sz * az[2],
        ])
  return out
}

function emptyStats() {
  return {
    minLon: Infinity,
    maxLon: -Infinity,
    minLat: Infinity,
    maxLat: -Infinity,
    minE: Infinity,
    maxE: -Infinity,
    minN: Infinity,
    maxN: -Infinity,
    minU: Infinity,
    maxU: -Infinity,
    nodes: 0,
    contents: 0,
  }
}

function addPoint(st, e, n, u, lon, lat) {
  if (e < st.minE) st.minE = e
  if (e > st.maxE) st.maxE = e
  if (n < st.minN) st.minN = n
  if (n > st.maxN) st.maxN = n
  if (u < st.minU) st.minU = u
  if (u > st.maxU) st.maxU = u
  if (lon < st.minLon) st.minLon = lon
  if (lon > st.maxLon) st.maxLon = lon
  if (lat < st.minLat) st.minLat = lat
  if (lat > st.maxLat) st.maxLat = lat
}

/**
 * 遍历 3D Tiles。root.transform 是 ENU→ECEF 的定位矩阵：
 * root 自己的 box 就在 ENU 帧（local=I4, world=T）；子节点的 box 帧才乘各自 transform。
 */
function walk(node, baseWorld, baseLocal, isRoot, st, leafFilter, leafOnly) {
  const world = isRoot ? baseWorld : node.transform ? mul(baseWorld, node.transform) : baseWorld
  const local = isRoot ? baseLocal : node.transform ? mul(baseLocal, node.transform) : baseLocal
  st.nodes++
  const uri = node.content?.uri
  const wanted = !leafOnly || (uri && leafFilter.test(path.basename(uri)))
  const box = node.boundingVolume?.box
  if (box && uri && wanted) {
    st.contents++
    for (const c of boxCorners(box)) {
      const l = xf(local, c)
      const w = xf(world, c)
      const g = ecefToGeo(w[0], w[1], w[2])
      addPoint(st, l[0], l[1], l[2], g.lon, g.lat)
    }
  }
  for (const child of node.children ?? [])
    walk(child, world, local, false, st, leafFilter, leafOnly)
}

function readTileset(file) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'))
  const st = emptyStats()
  walk(d.root, d.root.transform ?? I4, I4, true, st, /^$/, false)
  const st45 = emptyStats()
  walk(d.root, d.root.transform ?? I4, I4, true, st45, /^t[45].*\.glb$/, true)
  return { tileset: d, st, st45 }
}

/** GLB 内容 AABB → ENU（glTF(x,y,z)→ENU(x,−z,y)，逐轴取 min/max） */
function glbAabbENU(file) {
  const { json } = readGLB(file)
  const mn = [Infinity, Infinity, Infinity]
  const mx = [-Infinity, -Infinity, -Infinity]
  for (const m of json.meshes ?? [])
    for (const pr of m.primitives ?? []) {
      const a = json.accessors[pr.attributes?.POSITION]
      if (!a?.min || !a?.max) continue
      for (let i = 0; i < 3; i++) {
        mn[i] = Math.min(mn[i], a.min[i])
        mx[i] = Math.max(mx[i], a.max[i])
      }
    }
  return {
    minE: mn[0],
    maxE: mx[0],
    minN: -mx[2],
    maxN: -mn[2],
    minU: mn[1],
    maxU: mx[1],
  }
}

function fmt(n, d = 1) {
  return Number(n).toFixed(d)
}
function rng(a, b) {
  return `${fmt(a)} ~ ${fmt(b)}（宽 ${fmt(b - a)} m）`
}
function geoRng(a, b, c, d) {
  return `${a.toFixed(6)} ~ ${b.toFixed(6)} / ${c.toFixed(6)} ~ ${d.toFixed(6)}`
}
function line(label, o, skipU = false) {
  console.log(
    label.padEnd(26) +
      ' | E ' +
      rng(o.minE, o.maxE) +
      ' | N ' +
      rng(o.minN, o.maxN) +
      (skipU ? '' : ' | U ' + rng(o.minU, o.maxU))
  )
}

const ROOT = process.cwd()
const P = (p) => path.join(ROOT, p)
const REQUIRED = [
  'backend/static/qinzhou-port/tiles/tileset.json',
  'backend/static/qinzhou-port/rebuilt/tileset.json',
  'backend/static/qinzhou-port/rebuilt/roads/tileset.json',
  'backend/static/qinzhou-port/rebuilt/roads/roads.glb',
  'backend/static/qinzhou-port/rebuilt/ground/tileset.json',
  'backend/static/qinzhou-port/rebuilt/ground/ground.glb',
  'backend/static/qinzhou-port/imagery/imagery.json',
]
const missing = REQUIRED.filter((p) => !fs.existsSync(P(p)))
if (missing.length) {
  console.error('缺数据件（均为 gitignored 资产，需在带资产的机器上跑）：')
  for (const m of missing) console.error('  ' + m)
  process.exit(2)
}

const deliveredFile = P('backend/static/qinzhou-port/tiles/tileset.json')
const delivered = JSON.parse(fs.readFileSync(deliveredFile, 'utf8'))
const T = delivered.root.transform
const R = [T[0], T[1], T[2], T[4], T[5], T[6], T[8], T[9], T[10]]
const O = [T[12], T[13], T[14]]

function toENU(lon, lat, h = 0) {
  const p = geoToEcef(lon, lat, h)
  const d = [p[0] - O[0], p[1] - O[1], p[2] - O[2]]
  return [
    R[0] * d[0] + R[1] * d[1] + R[2] * d[2],
    R[3] * d[0] + R[4] * d[1] + R[5] * d[2],
    R[6] * d[0] + R[7] * d[1] + R[8] * d[2],
  ]
}

function enuToEcef(E, N, U) {
  return [
    O[0] + R[0] * E + R[3] * N + R[6] * U,
    O[1] + R[1] * E + R[4] * N + R[7] * U,
    O[2] + R[2] * E + R[5] * N + R[8] * U,
  ]
}

function geoBoxOf(st) {
  const out = emptyStats()
  for (const E of [st.minE, st.maxE])
    for (const N of [st.minN, st.maxN])
      for (const U of [
        Number.isFinite(st.minU) ? st.minU : 0,
        Number.isFinite(st.maxU) ? st.maxU : 0,
      ]) {
        const g = ecefToGeo(...enuToEcef(E, N, U))
        addPoint(out, E, N, U, g.lon, g.lat)
      }
  return out
}

const imagery = JSON.parse(
  fs.readFileSync(P('backend/static/qinzhou-port/imagery/imagery.json'), 'utf8')
)
const [w, s, e, n] = imagery.tiles[0].bbox
const imgSt = emptyStats()
for (const [lo, la] of [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
]) {
  const q = toENU(lo, la)
  addPoint(imgSt, q[0], q[1], q[2], lo, la)
}

const groundTs = JSON.parse(
  fs.readFileSync(P('backend/static/qinzhou-port/rebuilt/ground/tileset.json'), 'utf8')
)
const gb = groundTs.root.boundingVolume.box
const groundBox = {
  minE: gb[0] - gb[3],
  maxE: gb[0] + gb[3],
  minN: gb[1] - gb[7],
  maxN: gb[1] + gb[7],
  minU: gb[2] - gb[11],
  maxU: gb[2] + gb[11],
}
const groundGlb = glbAabbENU(P('backend/static/qinzhou-port/rebuilt/ground/ground.glb'))
const roadsGlb = glbAabbENU(P('backend/static/qinzhou-port/rebuilt/roads/roads.glb'))
const containers = readTileset(P('backend/static/qinzhou-port/rebuilt/tileset.json'))
const roads = readTileset(P('backend/static/qinzhou-port/rebuilt/roads/tileset.json'))
const delv = readTileset(deliveredFile)

console.log('=== B10 边界同域性（只读，ENU：x=东 / y=北）===')
console.log(
  'root.transform 与自建层一致: ' +
    [
      ['rebuilt', 'backend/static/qinzhou-port/rebuilt/tileset.json'],
      ['roads', 'backend/static/qinzhou-port/rebuilt/roads/tileset.json'],
      ['ground', 'backend/static/qinzhou-port/rebuilt/ground/tileset.json'],
    ]
      .map(([k, f]) => {
        const t = JSON.parse(fs.readFileSync(P(f), 'utf8')).root.transform
        return k + '=' + (JSON.stringify(t) === JSON.stringify(T))
      })
      .join(' ')
)
console.log('')
line('影像 bbox(imagery.json)', imgSt)
line('地面 tileset box', groundBox)
line('地面 GLB 实测 AABB', groundGlb)
line('道路 GLB 实测 AABB', roadsGlb)
line('集装箱 rebuilt 并集', containers.st)
line('交付包 t0~t5 内容并集', delv.st)
line('交付包 t4/t5 细瓦片并集', delv.st45)
console.log('')
console.log('--- 经纬度包围盒 ---')
console.log(
  '影像 imagery.json       lon ' +
    w.toFixed(6) +
    '~' +
    e.toFixed(6) +
    '  lat ' +
    s.toFixed(6) +
    '~' +
    n.toFixed(6)
)
const groundGeo = geoBoxOf(groundBox)
console.log(
  '地面 tileset box        lon ' +
    geoRng(groundGeo.minLon, groundGeo.maxLon, groundGeo.minLat, groundGeo.maxLat)
)
for (const [name, st] of [
  ['交付包内容 t0~t5', delv.st],
  ['交付包 t4/t5', delv.st45],
  ['集装箱并集', containers.st],
]) {
  if (!Number.isFinite(st.minLon)) continue
  console.log(name.padEnd(22) + ' lon ' + geoRng(st.minLon, st.maxLon, st.minLat, st.maxLat))
}
console.log('')
console.log('--- 地面盒 vs 影像 bbox 差（负值=地面盒多出）---')
console.log(
  `W ${fmt(groundBox.minE - imgSt.minE)} m | E ${fmt(imgSt.maxE - groundBox.maxE)} m | S ${fmt(groundBox.minN - imgSt.minN)} m | N ${fmt(imgSt.maxN - groundBox.maxN)} m`
)

const osmFile = P('.local/3d-diag/roads.json')
if (!fs.existsSync(osmFile)) {
  console.log('')
  console.log('--- 道路网络 vs 地面盒 --- SKIP：缺 ' + osmFile)
} else {
  const osm = JSON.parse(fs.readFileSync(osmFile, 'utf8'))
  const enuWays = []
  for (const el of osm.elements ?? []) {
    const geom = el.geometry ?? []
    if (geom.length < 2) continue
    enuWays.push(geom.map((g) => toENU(g.lon, g.lat)))
  }
  let pts = 0
  let segAll = 0
  let segIn = 0
  let segOut = 0
  let segCross = 0
  let minE = Infinity
  let maxE = -Infinity
  let minN = Infinity
  let maxN = -Infinity
  const insideOf = (b) => (E, N) => E >= b.minE && E <= b.maxE && N >= b.minN && N <= b.maxN
  const inside = insideOf(groundBox)
  for (const enu of enuWays) {
    for (const q of enu) {
      pts++
      minE = Math.min(minE, q[0])
      maxE = Math.max(maxE, q[0])
      minN = Math.min(minN, q[1])
      maxN = Math.max(maxN, q[1])
    }
    for (let i = 1; i < enu.length; i++) {
      const L = Math.hypot(enu[i][0] - enu[i - 1][0], enu[i][1] - enu[i - 1][1])
      segAll += L
      const a = inside(enu[i - 1][0], enu[i - 1][1])
      const b = inside(enu[i][0], enu[i][1])
      if (a && b) segIn += L
      else if (!a && !b) segOut += L
      else segCross += L
    }
  }
  console.log('')
  console.log('--- 道路网络 vs 地面盒 ---')
  console.log('OSM 点数=' + pts + '，道路总长=' + (segAll / 1000).toFixed(3) + ' km')
  console.log(
    '盒内=' +
      (segIn / 1000).toFixed(3) +
      ' km | 跨边界=' +
      (segCross / 1000).toFixed(3) +
      ' km | 盒外=' +
      (segOut / 1000).toFixed(3) +
      ' km'
  )
  console.log(
    '盒外占比=' + ((100 * (segOut + segCross / 2)) / segAll).toFixed(1) + '%（跨边界按半段计）'
  )
  console.log('OSM 点 AABB: E ' + rng(minE, maxE) + ' | N ' + rng(minN, maxN))
  console.log(
    '道路点超出地面盒：W ' +
      fmt(groundBox.minE - minE) +
      ' m | E ' +
      fmt(maxE - groundBox.maxE) +
      ' m | S ' +
      fmt(groundBox.minN - minN) +
      ' m | N ' +
      fmt(maxN - groundBox.maxN) +
      ' m'
  )

  console.log('')
  console.log('--- 候选域：道路保留率（逐段端点判定；跨边界按半段计）---')
  const mkBox = (minE, maxE, minN, maxN) => ({ minE, maxE, minN, maxN })
  const padBox = (b, m) => mkBox(b.minE - m, b.maxE + m, b.minN - m, b.maxN + m)
  const t45Box = mkBox(delv.st45.minE, delv.st45.maxE, delv.st45.minN, delv.st45.maxN)
  const osmBox = mkBox(minE, maxE, minN, maxN)
  const candidates = [
    ['地面片(现状)', groundBox],
    ['地面片+1km环', padBox(groundBox, 1000)],
    ['地面片+2km环', padBox(groundBox, 2000)],
    ['交付包t4/t5', t45Box],
    ['全OSM AABB', osmBox],
  ]
  for (const [name, b] of candidates) {
    const inBox = insideOf(b)
    let all = 0
    let inL = 0
    let crossL = 0
    let outL = 0
    let waysHit = 0
    let waysIn = 0
    for (const enu of enuWays) {
      let touched = false
      let allIn = true
      for (let i = 1; i < enu.length; i++) {
        const L = Math.hypot(enu[i][0] - enu[i - 1][0], enu[i][1] - enu[i - 1][1])
        all += L
        const a = inBox(enu[i - 1][0], enu[i - 1][1])
        const c = inBox(enu[i][0], enu[i][1])
        if (a && c) inL += L
        else if (!a && !c) {
          outL += L
          allIn = false
        } else {
          crossL += L
          allIn = false
        }
        if (a || c) touched = true
      }
      if (touched) waysHit++
      if (allIn) waysIn++
    }
    console.log(
      name.padEnd(14) +
        ' 保留 ' +
        ((100 * (inL + crossL / 2)) / all).toFixed(1) +
        '% | 盒内 ' +
        (inL / 1000).toFixed(2) +
        ' km | 跨边界 ' +
        (crossL / 1000).toFixed(2) +
        ' km | 盒外 ' +
        (outL / 1000).toFixed(1) +
        ' km | 触及 way ' +
        waysHit +
        '/' +
        enuWays.length +
        ' | 全在 ' +
        waysIn
    )
  }

  console.log('')
  console.log('--- 扩域代价（选项①，按候选域 bbox 上界估算；含 256px 取整余量）---')
  const midLat = ((s + n) / 2) * (Math.PI / 180)
  const mpp = (z) => (156543.03392 * Math.cos(midLat)) / 2 ** z
  for (const [name, b] of candidates) {
    const wM = b.maxE - b.minE
    const hM = b.maxN - b.minN
    const parts = []
    for (const z of [17, 16]) {
      const tx = Math.ceil(wM / mpp(z) / 256)
      const ty = Math.ceil(hM / mpp(z) / 256)
      parts.push('z' + z + ' ' + tx + '×' + ty + '=' + tx * ty + ' 瓦片')
    }
    console.log(
      name.padEnd(14) +
        ' ' +
        parts.join(' | ') +
        ' | 掩膜1024 ' +
        (wM / 1024).toFixed(1) +
        '×' +
        (hM / 1024).toFixed(1) +
        ' m/px | 掩膜2048 ' +
        (wM / 2048).toFixed(1) +
        '×' +
        (hM / 2048).toFixed(1) +
        ' m/px | 地面cell15 ' +
        Math.round(wM / 15) * Math.round(hM / 15) +
        ' 格'
    )
  }
}

console.log('')
console.log('--- 集装箱/交付内容 vs 地面盒（负值=超出）---')
console.log(
  '集装箱: W ' +
    fmt(containers.st.minE - groundBox.minE) +
    ' | E ' +
    fmt(groundBox.maxE - containers.st.maxE) +
    ' | S ' +
    fmt(containers.st.minN - groundBox.minN) +
    ' | N ' +
    fmt(groundBox.maxN - containers.st.maxN)
)
console.log(
  '交付包t4/t5: W ' +
    fmt(delv.st45.minE - groundBox.minE) +
    ' | E ' +
    fmt(groundBox.maxE - delv.st45.maxE) +
    ' | S ' +
    fmt(delv.st45.minN - groundBox.minN) +
    ' | N ' +
    fmt(groundBox.maxN - delv.st45.maxN)
)
console.log('')
console.log('--- 内容节点计数 ---')
console.log(
  '交付包 total=' +
    delv.st.contents +
    '（t4/t5=' +
    delv.st45.contents +
    '）| 集装箱=' +
    containers.st.contents +
    ' | 道路=' +
    roads.st.contents +
    ' | 地面=' +
    (groundTs.root.content ? 1 : 0)
)
