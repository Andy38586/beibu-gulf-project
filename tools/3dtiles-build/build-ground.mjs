#!/usr/bin/env node
/**
 * 作业区地面面片：按施工影像的**陆域掩膜**，把路与路之间的空地铺满。
 *
 * ## 为什么需要（用户原话）
 * 「这个港口区根本不连续，那些路之间的缝隙太大了」。道路层只画路面（5~12 m 宽的带），
 * 路网之间的空地露的是底图影像 ⇒ 看着不连续。地面面片把这些空地铺满，港区才成为一个连续面。
 * 高程（2026-10-05 起，C 口径）：与道路层**同源逐顶点**查询交付包参考地面（ground-ref.mjs，
 * r=48 m）；超半径回落常数 u₀+0.05。只改道路不改地面会把「路被埋」翻转成「路悬空」。
 *
 * ## 不覆盖水面
 * 逐格判 **四角 + 中心共 5 点**，任一点落水即不铺——与 rebuild-containers 的 onWater()
 * 同口径（那里踩过的坑：只判中心会把骑岸线的图元留下）。掩膜复用同一份
 * backend/static/qinzhou-port/imagery/water-mask.json，不另生成第二份判据。
 *
 * ## 轴序（本项目已踩两次，见 glb.mjs）
 * positions 走 enuToGltf（glTF Y-up）；root.boundingVolume.box **必须是 tile 局部
 * ENU(Z-up)**。这里盒直接从 ENU 统计得出，不经 glTF 反算——rework 掉的那次
 * （f662c00a）就是因为从 glTF 反算，盒中心落到椭球下 5351 m，整层被 Cesium 剔除。
 *
 * 用法：node tools/3dtiles-build/build-ground.mjs [--cell 15] [--out 目录]
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { groundLevel, makeToLocal } from './build-roads.mjs'
import { buildGLB, enuToGltf, GLTF_UP } from './glb.mjs'
import { buildGroundRef } from './ground-ref.mjs'
import { loadWaterMask } from './rebuild-containers.mjs'

const TILE_DIR = 'backend/static/qinzhou-port/tiles'
const GROUND_CELL = 15
/** 比道路层（groundU+0.15）低 10 cm：避免与路面抢深度，路仍然看得见 */
const GROUND_LIFT = 0.05
/**
 * 混凝土色。取偏亮暖灰：实测 [0.58,0.57,0.54] 经 Cesium 光照衰减后渲染成**暗蓝灰**，
 * 与影像里浅灰的堆场不是同色系（2026-10-03 改前/改后对照见 .local/3d-review/sheet-tone.png）。
 */
const TONE = [0.86, 0.85, 0.82]
/**
 * 边缘 alpha 渐变宽度（米，B10 裁定③「边缘淡化」）：自建片范围边界是影像 bbox 直边，
 * 单色面片到界即断 ⇒ 硬缝。片缘 EDGE_FADE_M 内 alpha 线性降到 0（材质 alphaMode:'BLEND'），
 * 让混凝土色淡入底图影像。Cesium 半透明 pass 会关闭该片深度写入——地面层本就贴在
 * 道路层下 10 cm（GROUND_LIFT），路仍走不透明 pass，视觉顺序不受影响（A/B 见 B10 收口单）。
 */
export const EDGE_FADE_M = 300

function rootTransform(tileDir = TILE_DIR) {
  const ts = JSON.parse(fs.readFileSync(path.join(tileDir, 'tileset.json'), 'utf8'))
  return ts.root.transform
}

/**
 * 片缘 alpha（纯函数）：网格参数坐标 (i,j)∈[0,nx]×[0,ny]，到最近片缘的归一化距离
 * 除以该轴渐变宽度（fadeX/fadeY = EDGE_FADE_M / 该轴物理宽度），两轴取小、夹 [0,1]。
 * 片缘=0（完全透出底图）、渐变带内线性、带外=1（不透明混凝土色）。
 */
export function edgeAlpha(i, j, nx, ny, fadeX, fadeY) {
  const dx = Math.min(i, nx - i) / nx / fadeX
  const dy = Math.min(j, ny - j) / ny / fadeY
  return Math.max(0, Math.min(1, Math.min(dx, dy)))
}

export function buildGround({
  outDir,
  rebuiltDir = 'backend/static/qinzhou-port/rebuilt',
  maskFile,
  imageryFile,
  cell = GROUND_CELL,
  tileDir = TILE_DIR,
  fadeM = EDGE_FADE_M,
}) {
  const meta = JSON.parse(fs.readFileSync(imageryFile, 'utf8'))
  const [w, s, e, n] = meta.tiles[0].bbox
  const mask = loadWaterMask(maskFile)
  const T = rootTransform(tileDir)
  const toLocal = makeToLocal(T)
  // 地面基准从**交付包几何**派生（见 build-roads.groundLevel 注释；旧实现读分桶盒底，低了 4.7 m）
  const groundU = groundLevel(tileDir)
  const u = groundU + GROUND_LIFT
  // C 口径（2026-10-05 用户裁定）：与道路层同源逐顶点参考（ground-ref，r=48 m 陆域池）。
  // 地面层必须与道路层**同笔**改——只改道路会让「路被埋」翻转成「路悬空」（§8.12b 实测 98.9%）。
  const ref = buildGroundRef({ tileDir })

  // 网格建在经纬度上（每格等经纬），逐顶点转 ENU——2 km 尺度上等经纬 ≈ 等米
  const midLat = ((s + n) / 2) * (Math.PI / 180)
  const nx = Math.max(1, Math.round(((e - w) * 111320 * Math.cos(midLat)) / cell))
  const ny = Math.max(1, Math.round(((n - s) * 110574) / cell))
  // 边缘渐变宽度 → 各轴归一化比例（片比渐变带还窄时整片都在渐变带内，夹 ≤1）
  const widthXm = (e - w) * 111320 * Math.cos(midLat)
  const widthYm = (n - s) * 110574
  const fadeX = Math.max(1e-6, Math.min(1, fadeM / widthXm))
  const fadeY = Math.max(1e-6, Math.min(1, fadeM / widthYm))

  const pos = [],
    norm = [],
    col = [],
    idx = []
  const enuMin = [Infinity, Infinity],
    enuMax = [-Infinity, -Infinity]
  let uMin = Infinity,
    uMax = -Infinity
  let nRef = 0,
    nFallback = 0,
    nFaded = 0
  const vid = new Int32Array((nx + 1) * (ny + 1)).fill(-1)
  const lngAt = (i) => w + (i / nx) * (e - w)
  const latAt = (j) => s + (j / ny) * (n - s)

  const vert = (i, j) => {
    const k = j * (nx + 1) + i
    if (vid[k] >= 0) return vid[k]
    const [E, N] = toLocal(lngAt(i), latAt(j))
    if (E < enuMin[0]) enuMin[0] = E
    if (E > enuMax[0]) enuMax[0] = E
    if (N < enuMin[1]) enuMin[1] = N
    if (N > enuMax[1]) enuMax[1] = N
    const q = ref.nearestU(E, N)
    if (q === null) nFallback++
    else nRef++
    const uu = q === null ? u : q + GROUND_LIFT
    if (uu < uMin) uMin = uu
    if (uu > uMax) uMax = uu
    const g = enuToGltf(E, N, uu)
    const a = edgeAlpha(i, j, nx, ny, fadeX, fadeY)
    if (a < 1) nFaded++
    pos.push(g[0], g[1], g[2])
    norm.push(GLTF_UP[0], GLTF_UP[1], GLTF_UP[2])
    col.push(TONE[0], TONE[1], TONE[2], a)
    const id = pos.length / 3 - 1
    vid[k] = id
    return id
  }

  let cells = 0,
    land = 0
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      cells++
      // 四角 + 中心：任一点落水即不铺（与集装箱 onWater 同判据）
      const wet =
        mask.isWater(lngAt(i), latAt(j)) ||
        mask.isWater(lngAt(i + 1), latAt(j)) ||
        mask.isWater(lngAt(i), latAt(j + 1)) ||
        mask.isWater(lngAt(i + 1), latAt(j + 1)) ||
        mask.isWater(lngAt(i + 0.5), latAt(j + 0.5))
      if (wet) continue
      land++
      const a = vert(i, j),
        b = vert(i + 1, j),
        c = vert(i, j + 1),
        d = vert(i + 1, j + 1)
      // glTF Y-up 下从 +Y 俯视的正面绕序：z 随 j 减小（z = −N）
      idx.push(a, b, c, b, d, c)
    }
  }
  if (!land) throw new Error('地面网格为空：掩膜里没有陆地格（bbox/掩膜对不上？）')

  // box 直接由 ENU 统计（绝不经 glTF 反算）；竖轴按逐顶点 u 的实际范围（C 口径后不再恒定）
  const box = [
    (enuMin[0] + enuMax[0]) / 2,
    (enuMin[1] + enuMax[1]) / 2,
    (uMin + uMax) / 2,
    (enuMax[0] - enuMin[0]) / 2 + cell,
    0,
    0,
    0,
    (enuMax[1] - enuMin[1]) / 2 + cell,
    0,
    0,
    0,
    (uMax - uMin) / 2 + 1,
  ]
  fs.mkdirSync(outDir, { recursive: true })
  const glb = buildGLB({
    meshes: [
      { primitives: [{ positions: pos, normals: norm, colors: col, indices: idx, material: 0 }] },
    ],
    materials: [
      {
        name: 'ground',
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
        // B10 裁定③：COLOR_0 带 VEC4 alpha，必须 BLEND 才逐顶点淡出（OPAQUE/MASK 会忽略 alpha）
        alphaMode: 'BLEND',
      },
    ],
    nodes: [{ mesh: 0 }],
  })
  fs.writeFileSync(path.join(outDir, 'ground.glb'), glb)
  const tileset = {
    asset: { version: '1.1', generator: 'beibu-3dtiles-build/build-ground' },
    geometricError: 64,
    root: {
      transform: T,
      boundingVolume: { box },
      // root GE=0：单叶层立刻被选中（不需要再细分），也免得高空机位整层不选
      geometricError: 0,
      refine: 'ADD',
      content: { uri: 'ground.glb' },
    },
  }
  fs.writeFileSync(path.join(outDir, 'tileset.json'), JSON.stringify(tileset, null, 2))
  return {
    cells,
    land,
    skipped: cells - land,
    vertices: pos.length / 3,
    triangles: idx.length / 3,
    bytes: glb.length,
    groundU,
    u,
    uMin,
    uMax,
    nRef,
    nFallback,
    fadeM,
    nFaded,
    refStats: ref.stats,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => {
    const i = process.argv.indexOf('--' + k)
    return i > -1 ? process.argv[i + 1] : d
  }
  const outDir = arg('out', 'backend/static/qinzhou-port/rebuilt/ground')
  const r = buildGround({
    outDir,
    maskFile: arg('mask', 'backend/static/qinzhou-port/imagery/water-mask.json'),
    imageryFile: arg('imagery', 'backend/static/qinzhou-port/imagery/imagery.json'),
    cell: Number(arg('cell', GROUND_CELL)),
    fadeM: Number(arg('fade', EDGE_FADE_M)),
  })
  console.log(
    '格 ' +
      r.cells +
      ' → 铺 ' +
      r.land +
      '（水面/岸线跳过 ' +
      r.skipped +
      '），' +
      r.triangles +
      ' 三角面 / ' +
      r.vertices +
      ' 顶点，' +
      (r.bytes / 1048576).toFixed(2) +
      ' MB'
  )
  console.log(
    '地面高程 u=' +
      r.u.toFixed(2) +
      ' m（箱区底面 ' +
      r.groundU.toFixed(2) +
      ' + ' +
      GROUND_LIFT +
      '）｜C 口径逐顶点：有参考 ' +
      r.nRef +
      ' 顶点 / 回落 ' +
      r.nFallback +
      ' ｜u 范围 ' +
      r.uMin.toFixed(2) +
      '..' +
      r.uMax.toFixed(2) +
      ' m → ' +
      outDir
  )
  console.log(
    '参考地面：' +
      r.refStats.cells +
      ' 格 / ' +
      r.refStats.vertices +
      ' 顶点（rail/concrete/opaque，4 m 格，r=48 m）'
  )
  console.log('边缘渐变：' + r.nFaded + ' 顶点 alpha<1（fade=' + r.fadeM + ' m，alphaMode=BLEND）')
}
