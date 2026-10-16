#!/usr/bin/env node
/**
 * 集装箱批量放置：把交付包的「箱区棱柱」换成真实箱型实例。
 *
 * ## 输入与输出
 *
 * 输入 = 钦州港交付包（backend/static/qinzhou-port/tiles）里 cargo 材质的连通分量。
 * 每个分量是一个**箱区**：平面 8.5×11.3 m 量级、高度是 2.591 m 的整数倍
 * （实测 2.59 / 5.18 / 7.77 / 10.36 / 12.96 = 1~5 层），代表一摞箱而不是一个箱。
 *
 * 输出 = 新的 3D Tiles 目录（默认 backend/static/qinzhou-port/rebuilt）：
 *   models/*.glb   5 款箱型（由 container-models.mjs 生成）
 *   cell_*.glb     按 400 m 网格切块、块内所有箱合并成一个 mesh
 *   tileset.json   与源包**同一 root.transform**，故落位逐位对齐
 *
 * ## 为什么按格合并而不是每箱一个节点
 *
 * 实测作业区有 7745 个箱区，按每区 3~9 箱放置后约 2 万~7 万箱。每箱一个 glTF 节点
 * 会让 JSON 膨胀到几十 MB；按 400 m 格合并后每个 cell 一个 mesh，节点数降到个位数。
 *
 * 用法：node tools/3dtiles-build/rebuild-containers.mjs [--out 目录] [--cell 400]
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { accessor, readGLB } from '../lib/glb.mjs'
import { buildGLB, enuToGltf } from './glb.mjs'
import { CONTAINER_TYPES } from './container-models.mjs'
import { makeEnuToLngLat } from '../lib/geo.mjs'

const TILE_DIR = 'backend/static/qinzhou-port/tiles'
/** 只重建作业区（与前端 keepSphere 一致：局部 ENU (1014.26,2159.18) r=1500） */
const OP_CENTER = [1014.26, 2159.18]
const OP_RADIUS = 1500
const LAYER_H = 2.591

/* ---------- 提取箱区 ---------- */
const Q = 0.25
function extractBlocks(tileDir) {
  const ts = JSON.parse(fs.readFileSync(path.join(tileDir, 'tileset.json'), 'utf8'))
  const kept = []
  ;(function walk(n) {
    const b = n.boundingVolume?.box
    if (n.content?.uri && b) {
      const d = Math.hypot(b[0] - OP_CENTER[0], b[1] - OP_CENTER[1])
      if (d <= OP_RADIUS + 600) kept.push(n)
    }
    ;(n.children ?? []).forEach(walk)
  })(ts.root)

  const blocks = []
  for (const node of kept) {
    const fp = path.join(tileDir, node.content.uri)
    if (!fs.existsSync(fp)) continue
    const { json, bin } = readGLB(fp)
    for (const m of json.meshes ?? [])
      for (const pr of m.primitives ?? []) {
        const matName = json.materials?.[pr.material]?.name ?? ''
        if (matName !== 'cargo') continue
        const pos = accessor(json, bin, pr.attributes.POSITION)
        const idx = pr.indices !== undefined ? accessor(json, bin, pr.indices) : null
        const N = pos.length / 3
        const key = new Array(N),
          map = new Map()
        for (let i = 0; i < N; i++) {
          const k =
            Math.round(pos[i * 3] / Q) +
            '|' +
            Math.round(pos[i * 3 + 1] / Q) +
            '|' +
            Math.round(pos[i * 3 + 2] / Q)
          if (!map.has(k)) map.set(k, [])
          map.get(k).push(i)
          key[i] = k
        }
        const keys = [...map.keys()],
          ki = new Map(keys.map((k, i) => [k, i]))
        const parent = new Int32Array(keys.length).map((_, i) => i)
        const find = (x) => {
          while (parent[x] !== x) {
            parent[x] = parent[parent[x]]
            x = parent[x]
          }
          return x
        }
        const uni = (a, b) => {
          a = find(a)
          b = find(b)
          if (a !== b) parent[b] = a
        }
        const cnt = idx ? idx.length : N
        for (let i = 0; i + 2 < cnt; i += 3) {
          const a = idx ? idx[i] : i,
            b = idx ? idx[i + 1] : i + 1,
            c = idx ? idx[i + 2] : i + 2
          uni(ki.get(key[a]), ki.get(key[b]))
          uni(ki.get(key[b]), ki.get(key[c]))
        }
        const groups = new Map()
        for (const [k, ids] of map) {
          const r = find(ki.get(k))
          if (!groups.has(r)) groups.set(r, [])
          for (const i of ids) groups.get(r).push(i)
        }
        for (const [, ids] of groups) {
          if (ids.length < 4) continue
          let x0 = 1e18,
            x1 = -1e18,
            y0 = 1e18,
            y1 = -1e18,
            z0 = 1e18,
            z1 = -1e18
          for (const i of ids) {
            const x = pos[i * 3],
              y = pos[i * 3 + 1],
              z = pos[i * 3 + 2]
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
            if (z < z0) z0 = z
            if (z > z1) z1 = z
          }
          // glTF(x,y,z) -> tile ENU(x, -z, y)
          const e = x1 - x0,
            nn = z1 - z0,
            u = y1 - y0
          if (e <= 3 || nn <= 1.5) continue
          const cx = (x0 + x1) / 2,
            cy = -(z0 + z1) / 2,
            cz = (y0 + y1) / 2
          // 堆场走向：对箱区顶点在水平面做 PCA 取主轴角。
          // 不能只看包围盒长短边——实测堆场整体相对 E/N 轴旋转约 30°，
          // 按轴对齐排箱会让箱子横跨堆场边界（渲染图里一眼可见）。
          let sxx = 0,
            sxy = 0,
            syy = 0,
            mx = 0,
            my = 0
          for (const i of ids) {
            mx += pos[i * 3]
            my += -pos[i * 3 + 2]
          }
          mx /= ids.length
          my /= ids.length
          for (const i of ids) {
            const dx = pos[i * 3] - mx,
              dy = -pos[i * 3 + 2] - my
            sxx += dx * dx
            sxy += dx * dy
            syy += dy * dy
          }
          const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
          // 沿主轴/副轴的真实投影跨度（不能用包围盒长短边合成——实测那样会放大 ~40%，
          // 排箱数从 7.9 万涨到 25 万）
          const ca = Math.cos(angle),
            sa = Math.sin(angle)
          let l0 = 1e18,
            l1 = -1e18,
            s0 = 1e18,
            s1 = -1e18
          for (const i of ids) {
            const dx = pos[i * 3] - mx,
              dy = -pos[i * 3 + 2] - my
            const pl = dx * ca + dy * sa
            const ps = -dx * sa + dy * ca
            if (pl < l0) l0 = pl
            if (pl > l1) l1 = pl
            if (ps < s0) s0 = ps
            if (ps > s1) s1 = ps
          }
          blocks.push({ cx, cy, cz, e, n: nn, u, angle, lenLong: l1 - l0, lenShort: s1 - s0 })
        }
      }
  }
  return { blocks, transform: ts.root.transform }
}

/* ---------- 排箱 ---------- */
function pickType(blockE, blockN, blockLong, seed) {
  const long = blockLong ?? Math.max(blockE, blockN)
  const fits40 = CONTAINER_TYPES.filter((t) => t.len <= long + 0.3 && t.len > 6.5)
  const fits20 = CONTAINER_TYPES.filter((t) => t.len <= long + 0.3)
  const pool = fits40.length && seed % 3 !== 0 ? fits40 : fits20
  return pool[seed % pool.length]
}

function layoutBlock(b, seed) {
  const t = pickType(b.e, b.n, b.lenLong, seed)
  const GAP = 0.12
  const ca = Math.cos(b.angle),
    sa = Math.sin(b.angle)
  // 箱区的 PCA 主轴长度：用顶点到主轴的投影跨度（包围盒在对角时会长 ~40%）
  const alongLong = Math.max(1, Math.floor((b.lenLong + GAP) / (t.len + GAP)))
  const alongShort = Math.max(1, Math.floor((b.lenShort + GAP) / (t.wid + GAP)))
  const layers = Math.max(1, Math.round(b.u / LAYER_H))
  const out = []
  for (let L = 0; L < layers; L++) {
    for (let i = 0; i < alongLong; i++) {
      for (let j = 0; j < alongShort; j++) {
        const uOff = (i - (alongLong - 1) / 2) * (t.len + GAP)
        const vOff = (j - (alongShort - 1) / 2) * (t.wid + GAP)
        // 沿 PCA 主轴摆放：局部 (uOff 沿长轴, vOff 沿短轴) 旋到 ENU
        const de = uOff * ca - vOff * sa
        const dn = uOff * sa + vOff * ca
        out.push({
          type: t,
          e: b.cx + de,
          n: b.cy + dn,
          u: b.cz - b.u / 2 + (L + 0.5) * LAYER_H,
          rotY: b.angle,
        })
      }
    }
  }
  return out
}

/**
 * 水面掩膜（由施工影像生成，见 tools/3dtiles-build/make-water-mask.py）。
 *
 * **为什么需要**：交付包的 cargo 棱柱有几个跨在码头岸线上，按它们排箱会把整排
 * 集装箱排进海里——实测 8.3% 的模型像素压在海面上（.local/3d-diag/water-check2.png）。
 * 用户裁定「以施工影像为准」，故用影像判水面并在放置时剔除。
 */
export function loadWaterMask(file) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))
  const bits = Buffer.from(m.bits, 'base64')
  const size = m.size
  const [w, s, e, n] = m.bbox
  return {
    size,
    /** 经纬度是否落在水面格上；越界按「非水面」处理（不误删） */
    isWater(lng, lat) {
      const x = Math.floor(((lng - w) / (e - w)) * size)
      const y = Math.floor(((n - lat) / (n - s)) * size)
      if (x < 0 || y < 0 || x >= size || y >= size) return false
      const i = y * size + x
      return (bits[i >> 3] & (0x80 >> (i & 7))) !== 0
    },
  }
}

/**
 * 实例是否压在水面上——按**外廓**采样，不只看中心。
 *
 * 为什么：第一版只判中心，剔掉 758 个（2.7%）但模型压水像素几乎没降（8.3%→8.4%）。
 * 原因是那条入海的箱子**中心还在岸上**，只有外廓伸进水里——中心判据看不见它。
 *
 * 判据：中心 + 四角共 5 点，**≥1 点在水面**即剔除。
 *
 * 为什么取 1 而不是 2：实测取 2 时仍剩 8.3% 的模型像素压在水上——那些箱子是
 * **骑在岸线上**（左半在水、右半在陆），5 点里只有 1~2 点落水，2 的门槛拦不住。
 * 集装箱堆场里没有"合法踩水"的箱子，故取 1。
 */
function onWater(mask, toLngLat, inst) {
  const t = inst.type
  const hl = t.len / 2
  const hw = t.wid / 2
  const ca = Math.cos(inst.rotY)
  const sa = Math.sin(inst.rotY)
  const pts = [
    [0, 0],
    [hl, hw],
    [hl, -hw],
    [-hl, hw],
    [-hl, -hw],
  ]
  let wet = 0
  for (const [du, dv] of pts) {
    const de = du * ca - dv * sa
    const dn = du * sa + dv * ca
    const [lng, lat] = toLngLat(inst.e + de, inst.n + dn, inst.u)
    if (mask.isWater(lng, lat)) wet++
  }
  return wet >= 1
}

export function rebuild({ outDir, cellSize = 400, modelsDir }) {
  const { blocks, transform } = extractBlocks(TILE_DIR)
  const models = {}
  for (const t of CONTAINER_TYPES) {
    const { json, bin } = readGLB(path.join(modelsDir, t.key + '.glb'))
    const pr = json.meshes[0].primitives[0]
    models[t.key] = {
      geo: {
        positions: accessor(json, bin, pr.attributes.POSITION),
        normals: accessor(json, bin, pr.attributes.NORMAL),
        colors: accessor(json, bin, pr.attributes.COLOR_0),
        indices: accessor(json, bin, pr.indices),
      },
      color: t.color,
    }
  }

  // 水面裁剪：实例中心落在影像判定为水面的格上就丢弃
  const maskFile = path.join(modelsDir, '..', '..', 'imagery', 'water-mask.json')
  const mask = fs.existsSync(maskFile) ? loadWaterMask(maskFile) : null
  const toLngLat = makeEnuToLngLat(transform)
  let droppedWater = 0

  const cells = new Map()
  let placed = 0
  blocks.forEach((b, bi) => {
    for (const inst of layoutBlock(b, bi)) {
      if (mask && onWater(mask, toLngLat, inst)) {
        droppedWater++
        continue
      }
      const gx = Math.floor(inst.e / cellSize),
        gy = Math.floor(inst.n / cellSize)
      const key = gx + '_' + gy
      if (!cells.has(key))
        cells.set(key, { byStyle: new Map(), min: [1e18, 1e18, 1e18], max: [-1e18, -1e18, -1e18] })
      const cell = cells.get(key)
      if (!cell.byStyle.has(inst.type.key)) cell.byStyle.set(inst.type.key, [])
      cell.byStyle.get(inst.type.key).push(inst)
      const t = inst.type
      // 包络要按 rotY 真旋转取四角极值。`rotY ? 交换轴 : 不交换` 只对 ±90° 成立，
      // 而 rotY 是箱区 PCA 角（连续值，实测多为 10°~30°）：交换轴会把长 200 m 的
      // 箱区包络转成 90°（E 向只剩箱宽 2.4 m），实例整排戳出包围盒，
      // Cesium 按小盒子剔除 ⇒ 旋转相机时整格集装箱闪进闪出。
      const ca = Math.cos(inst.rotY)
      const sa = Math.sin(inst.rotY)
      const hl = t.len / 2
      const hw = t.wid / 2
      for (const [de, dn] of [
        [-hl, -hw],
        [hl, -hw],
        [hl, hw],
        [-hl, hw],
      ]) {
        const ee = inst.e + de * ca - dn * sa
        const nn = inst.n + de * sa + dn * ca
        if (ee < cell.min[0]) cell.min[0] = ee
        if (ee > cell.max[0]) cell.max[0] = ee
        if (nn < cell.min[1]) cell.min[1] = nn
        if (nn > cell.max[1]) cell.max[1] = nn
      }
      if (inst.u - LAYER_H / 2 < cell.min[2]) cell.min[2] = inst.u - LAYER_H / 2
      if (inst.u + LAYER_H / 2 > cell.max[2]) cell.max[2] = inst.u + LAYER_H / 2
      placed++
    }
  })

  fs.mkdirSync(outDir, { recursive: true })
  const children = []
  for (const [key, cell] of cells) {
    const styleKeys = [...cell.byStyle.keys()].sort()
    const meshes = [],
      nodes = [],
      materials = []
    let tris = 0
    styleKeys.forEach((sk, i) => {
      const m = models[sk]
      meshes.push({
        primitives: [
          {
            positions: m.geo.positions,
            normals: m.geo.normals,
            colors: m.geo.colors,
            indices: m.geo.indices,
            material: i,
          },
        ],
      })
      materials.push({
        name: sk,
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0.35,
          roughnessFactor: 0.65,
        },
      })
      const insts = cell.byStyle.get(sk)
      const translation = [],
        rotation = []
      for (const it of insts) {
        const [gx, gy, gz] = enuToGltf(it.e, it.n, it.u)
        translation.push(gx, gy, gz)
        const h = it.rotY / 2
        rotation.push(0, Math.sin(h), 0, Math.cos(h))
      }
      tris += (m.geo.indices.length / 3) * insts.length
      nodes.push({ mesh: i, instancing: { translation, rotation } })
    })
    const uri = 'cell_' + key + '.glb'
    fs.writeFileSync(path.join(outDir, uri), buildGLB({ meshes, materials, nodes }))
    const c = [
      (cell.min[0] + cell.max[0]) / 2,
      (cell.min[1] + cell.max[1]) / 2,
      (cell.min[2] + cell.max[2]) / 2,
    ]
    const h = [
      (cell.max[0] - cell.min[0]) / 2 + 2,
      (cell.max[1] - cell.min[1]) / 2 + 2,
      (cell.max[2] - cell.min[2]) / 2 + 2,
    ]
    children.push({
      boundingVolume: { box: [c[0], c[1], c[2], h[0], 0, 0, 0, h[1], 0, 0, 0, h[2]] },
      geometricError: 0,
      refine: 'ADD',
      content: { uri },
      extras: { cell: key, styles: styleKeys.length, triangles: tris },
    })
  }
  const span = Math.max(
    ...children.map((c) => Math.max(c.boundingVolume.box[3], c.boundingVolume.box[7]))
  )
  const rootBox = [OP_CENTER[0], OP_CENTER[1], 10, span + 400, 0, 0, 0, span + 400, 0, 0, 0, 60]
  const tileset = {
    asset: { version: '1.1', generator: 'beibu-3dtiles-build/rebuild-containers' },
    geometricError: 4096,
    root: {
      transform,
      boundingVolume: { box: rootBox },
      geometricError: 2048,
      refine: 'ADD',
      children,
    },
  }
  fs.writeFileSync(path.join(outDir, 'tileset.json'), JSON.stringify(tileset))
  return {
    blocks: blocks.length,
    placed,
    droppedWater,
    cells: children.length,
    tris: children.reduce((s, c) => s + c.extras.triangles, 0),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (k, d) => {
    const i = process.argv.indexOf(k)
    return i > 0 ? process.argv[i + 1] : d
  }
  const outDir = arg('--out', 'backend/static/qinzhou-port/rebuilt')
  const cellSize = Number(arg('--cell', 400))
  const r = rebuild({ outDir, cellSize, modelsDir: path.join(outDir, 'models') })
  console.log(
    '箱区 ' +
      r.blocks +
      ' 个 → 放置集装箱 ' +
      r.placed +
      ' 个（水面剔除 ' +
      r.droppedWater +
      ' 个）'
  )
  console.log('切块 ' + r.cells + ' 个，合计 ' + r.tris + ' 三角面 → ' + outDir)
}
