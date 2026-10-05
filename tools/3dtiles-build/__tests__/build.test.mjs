// 3D Tiles 构建工具测试（glb 写出器 + 集装箱建模 + 放置）。
//
// 钉死三件事：
//   ① **坐标换算**：tile ENU(E,N,U) → glTF(x,y,z) 必须是 (E, U, −N)。写错的表现是
//      整层箱子平躺或镜像，不是"少几个箱子"——最难从渲染图上看出来的一类错。
//   ② **GLB 结构自洽**：accessor.count 与 bufferView 长度、indices 最大值与顶点数
//      必须对得上；Cesium 对越界 indices 是静默丢弃，不报错。
//   ③ **实例化确实被用上**：节点必须带 EXT_mesh_gpu_instancing 且 extensionsUsed 声明它。
//      少了这条声明 Cesium 会忽略扩展 ⇒ 箱子全堆在原点。
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildAll, buildBridge } from '../build-bridges.mjs'
import { ribbon } from '../build-canal.mjs'
import { buildGround } from '../build-ground.mjs'
import { buildRoads, extrudeWay } from '../build-roads.mjs'
import { buildContainer, CONTAINER_TYPES, generateAll } from '../container-models.mjs'
import { box, buildGLB, enuToGltf } from '../glb.mjs'
import { buildGroundRef } from '../ground-ref.mjs'

/**
 * 交付包资产不入库（backend/static/qinzhou-port/** 全树 gitignored），而 buildRoads /
 * buildGround 要从交付包派生 root.transform 与地面基准 u₀。CI 的干净检出没有该资产
 * （2026-10-05 实测 test:tools 两条用例 ENOENT），故测试造一份**最小夹具**自供：
 * 一份 tileset.json（钦州港交付包锚点的 ENU→ECEF 常数矩阵）+ 一颗带 rail/concrete
 * 两材质的 t4 瓦片；高度由夹具给（rail −17.56 / concrete −17.54 ⇒ u₀=−17.55），
 * 不读生产资产，删改盒轴序等实现仍会让下方断言变红。
 */
function makePortTileFixture(dir, { railY = -17.56, concreteY = -17.54 } = {}) {
  const tileDir = path.join(dir, 'tiles')
  fs.mkdirSync(tileDir, { recursive: true })
  // 锚点 108.6375E / 21.655N 的 ENU→ECEF（柱主序）；与交付包同锚便于沿用既有断言
  const transform = [
    -0.9475594486477835, -0.3195795539115551, 0, 0, 0.11793025766023646, -0.34966545437494045,
    0.9294226833604593, 0, -0.29702448654361613, 0.8806832454057802, 0.3690169042944284, 0,
    -1895326.9516715512, 5619680.418698535, 2338950.5411119526, 1,
  ]
  fs.writeFileSync(path.join(tileDir, 'tileset.json'), JSON.stringify({ root: { transform } }))
  const tri = (y) => ({
    positions: [0, y, 0, 10, y, 0, 0, y, 10],
    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0],
    colors: [1, 1, 1, 1, 1, 1, 1, 1, 1],
    indices: [0, 1, 2],
  })
  const mat = (name) => ({
    name,
    pbrMetallicRoughness: {
      baseColorFactor: [1, 1, 1, 1],
      metallicFactor: 0,
      roughnessFactor: 0.9,
    },
  })
  fs.writeFileSync(
    path.join(tileDir, 't4_0_0.glb'),
    buildGLB({
      meshes: [
        { primitives: [{ ...tri(railY), material: 0 }] },
        { primitives: [{ ...tri(concreteY), material: 1 }] },
      ],
      materials: [mat('rail'), mat('concrete')],
      nodes: [{ mesh: 0 }, { mesh: 1 }],
    })
  )
  return tileDir
}

describe('enuToGltf — tile ENU → glTF Y-up', () => {
  it('(E,N,U) → (E, U, −N)', () => {
    expect(enuToGltf(10, 20, 30)).toEqual([10, 30, -20])
  })

  // toEqual 用 Object.is 比较，−0 与 +0 不相等；而 −N 在 N=0 时天然产生 −0，
  // 属正常值不是缺陷，故比较前统一归一（v + 0 把 −0 变成 +0）。
  const norm = (a) => a.map((v) => v + 0)

  it('原点保持原点；三轴不混淆', () => {
    expect(norm(enuToGltf(0, 0, 0))).toEqual([0, 0, 0])
    // 只动 N 时只有 glTF z 变（且反号）——若实现写成 (E,N,U) 直通，这条必红
    expect(norm(enuToGltf(0, 5, 0))).toEqual([0, 0, -5])
    // 只动 U 时只有 glTF y 变
    expect(norm(enuToGltf(0, 0, 7))).toEqual([0, 7, 0])
  })
})

// 接线判据（不是纯函数判据）：三个挤出器**必须真的调用** enuToGltf。
// 样本刻意取 N=5000 / 高程 −20：直通 ENU 时 y≈N（几千），过 enuToGltf 后 y 恒等于高程。
// 2026-10-03 实测这三个写出器就是直通的 ⇒ 钦州港路网浮在 1~11 km、运河浮到 49 km、
// 城区五桥整体挪位；而上一窗口自建的光栅器不施加 Y_UP_TO_Z_UP，自己看是"落地"的。
describe('挤出器 — ENU 必须换成 glTF Y-up（删掉这条断言，浮空即复现）', () => {
  const G = -20.35
  const LIFT = 0.15

  it('extrudeWay：y 恒等于地面高程，z = −N', () => {
    const g = extrudeWay(
      [
        [0, 5000],
        [200, 5000],
      ],
      10,
      G,
      LIFT
    )
    for (let i = 0; i < g.positions.length; i += 3) {
      expect(g.positions[i + 1]).toBeCloseTo(G + LIFT, 6) // 直通 ENU 时这里会是 5000
      // 路面有半宽 5 m 的横向偏移，故 z 落在 −N±半宽内（直通 ENU 时 z 会是 −20.2）
      expect(Math.abs(g.positions[i + 2] + 5000)).toBeLessThanOrEqual(5.001)
    }
    for (let i = 0; i < g.normals.length; i += 3) {
      // 归一 −0（GLTF_UP 的 z 是 −N=−0；Object.is(−0,+0)=false，见文件头说明）
      expect([g.normals[i] + 0, g.normals[i + 1] + 0, g.normals[i + 2] + 0]).toEqual([0, 1, 0])
    }
    expect(g.indices.length).toBe(6)
  })

  it('ribbon（运河带）：同判据', () => {
    const r = ribbon(
      [
        [0, 5000],
        [200, 5000],
      ],
      60,
      1,
      [0.2, 0.4, 0.8],
      G
    )
    for (let i = 0; i < r.positions.length; i += 3) {
      expect(r.positions[i + 1]).toBeCloseTo(G + 1, 6)
      expect(Math.abs(r.positions[i + 2] + 5000)).toBeLessThanOrEqual(60.001)
    }
  })

  it('ribbon（逐点大地高）：三元点按各点 U 分量 + lift 挤出（2026-10-05 统一基准）', () => {
    const r = ribbon(
      [
        [0, 0, 10],
        [200, 0, 20],
      ],
      60,
      1,
      [0.11, 0.28, 0.46],
      0
    )
    // 顶点序：A(i,uA) / B(i+1,uB) / C(i+1,uB) / D(i,uA)，lift=1
    expect([r.positions[1], r.positions[4], r.positions[7], r.positions[10]]).toEqual([
      11, 21, 21, 11,
    ])
  })

  it('buildBridge：整桥竖直范围只有几十米（直通 ENU 时会变成 N≈2220）', () => {
    const toLocal = (lon, lat) => [(lon - 108.6) * 104000, (lat - 21.95) * 111000]
    const way = {
      geometry: [
        { lon: 108.61, lat: 21.97 },
        { lon: 108.62, lat: 21.97 },
      ],
    }
    const b = buildBridge([way], { deckW: 20, towers: false }, toLocal)
    expect(b.spans).toBeGreaterThan(0)
    const ys = []
    for (let i = 1; i < b.positions.length; i += 3) ys.push(b.positions[i])
    expect(Math.max(...ys)).toBeLessThan(24) // 桥面顶 22 m + 栏杆 1.2 m
    expect(Math.min(...ys)).toBeGreaterThan(-4) // 桥墩底
  })
})

// 绕序判据（2026-10-04 补）：几何法线必须朝 +Y = 声明的 GLTF_UP。
// 为什么单列一条：绕反了**不报错、不缺瓦片、包围盒照旧**，只在 Cesium 默认 backFaceCulling
// 下整层不可见——运行时实测港区道路层画面贡献 0.00%（人为关掉剔除 2.71%）、运河带在马道
// 机位差 5.5%（6.71% → 12.18%）。静态读 GLB 也看不出来，除非算这条叉积。
describe('挤出器 — 四边形绕序必须是正面朝上（否则背面剔除整层不可见）', () => {
  /** 三角面几何法线（右手：cross(B−A, C−A) 归一） */
  const triNormal = (positions, i0, i1, i2) => {
    const p = (i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]
    const [ax, ay, az] = p(i0)
    const b = p(i1)
    const c = p(i2)
    const u = [b[0] - ax, b[1] - ay, b[2] - az]
    const v = [c[0] - ax, c[1] - ay, c[2] - az]
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const L = Math.hypot(...n) || 1
    return n.map((x) => x / L)
  }

  it('extrudeWay（港区道路）：两个三角的几何法线都朝 +Y', () => {
    const g = extrudeWay(
      [
        [0, 0],
        [200, 0],
      ],
      10,
      -17.55,
      0.15
    )
    // 反向的 way（OSM 里两个方向都有）：绕序判据必须与方向无关
    const rev = extrudeWay(
      [
        [200, 0],
        [0, 0],
      ],
      10,
      -17.55,
      0.15
    )
    for (const geo of [g, rev]) {
      expect(geo.indices.length).toBe(6)
      expect(triNormal(geo.positions, ...geo.indices.slice(0, 3))[1]).toBeGreaterThan(0.99)
      expect(triNormal(geo.positions, ...geo.indices.slice(3, 6))[1]).toBeGreaterThan(0.99)
    }
  })

  it('ribbon（运河带水面/堤顶）：两个三角的几何法线都朝 +Y', () => {
    const r = ribbon(
      [
        [0, 0],
        [200, 0],
      ],
      60,
      0.4,
      [0.11, 0.28, 0.46],
      0,
      0
    )
    expect(r.indices.length).toBe(6)
    expect(triNormal(r.positions, ...r.indices.slice(0, 3))[1]).toBeGreaterThan(0.99)
    expect(triNormal(r.positions, ...r.indices.slice(3, 6))[1]).toBeGreaterThan(0.99)
  })

  it('buildBridge（城区五桥）：几何法线与声明法线同向（否则画的是内壁、默认剔除下正向 0%）', () => {
    const toLocal = (lon, lat) => [(lon - 108.6) * 104000, (lat - 21.95) * 111000]
    const way = {
      geometry: [
        { lon: 108.61, lat: 21.97 },
        { lon: 108.63, lat: 21.97 },
      ],
    }
    const b = buildBridge([way], { deckW: 20, towers: true }, toLocal)
    expect(b.spans).toBeGreaterThan(0)
    let n = 0,
      pos = 0
    for (let i = 0; i < b.indices.length; i += 3) {
      const g = triNormal(b.positions, ...b.indices.slice(i, i + 3))
      const d = b.normals[b.indices[i] * 3]
      const e = b.normals[b.indices[i] * 3 + 1]
      const f = b.normals[b.indices[i] * 3 + 2]
      const L = Math.hypot(d, e, f) || 1
      n++
      if ((g[0] * d + g[1] * e + g[2] * f) / L > 0) pos++
    }
    // 逐面同向：位置逐位不变的前提下，绕序必须与声明的 box 法线一致
    expect(n).toBeGreaterThan(0)
    expect(pos / n).toBeGreaterThan(0.99)
  })

  it('集装箱模型：所有面的几何法线与声明法线同向（混合绕序会让箱体缺顶盖）', () => {
    expect(CONTAINER_TYPES.length).toBeGreaterThan(0)
    for (const t of CONTAINER_TYPES) {
      const geo = buildContainer(t)
      let n = 0,
        pos = 0
      for (let i = 0; i < geo.indices.length; i += 3) {
        const g = triNormal(geo.positions, ...geo.indices.slice(i, i + 3))
        const k = geo.indices[i] * 3
        const L = Math.hypot(geo.normals[k], geo.normals[k + 1], geo.normals[k + 2]) || 1
        n++
        if ((g[0] * geo.normals[k] + g[1] * geo.normals[k + 1] + g[2] * geo.normals[k + 2]) / L > 0)
          pos++
      }
      expect(n).toBeGreaterThan(0)
      expect(pos / n).toBeGreaterThan(0.99)
    }
  })
})

describe('buildRoads — root.boundingVolume 必须是 ENU(Z-up)', () => {
  // 为什么单独钉这一条：positions 是 glTF Y-up、boundingVolume 是 ENU，两者轴序不同。
  // 2026-10-03 实测：把 glTF 的 min/max 直接当 box 用 ⇒ 包围盒中心落到椭球下 5351 m，
  // Cesium 在近机位把整层剔除（visited=0），路网在港区根本不显示且**零报错**。
  it('盒中心第 2 分量是北向（上千），第 3 分量是地面高程（−20 上下），竖半轴很小', () => {
    const dir = 'node_modules/.cache/beibu-roads-box-test'
    fs.mkdirSync(dir, { recursive: true })
    const osm = {
      elements: [
        {
          type: 'way',
          id: 1,
          tags: { highway: 'service' },
          // 南北走向：这样"北向"在盒里是一个大数，轴序写错时 b[1] 会变成高程（−20 量级）⇒ 必红
          geometry: [
            { lon: 108.64, lat: 21.67 },
            { lon: 108.64, lat: 21.69 },
          ],
        },
      ],
    }
    fs.writeFileSync(path.join(dir, 'osm.json'), JSON.stringify(osm))
    const tileDir = makePortTileFixture(dir)
    buildRoads({
      osmFile: path.join(dir, 'osm.json'),
      outDir: path.join(dir, 'out'),
      rebuiltDir: 'backend/static/qinzhou-port/rebuilt',
      tileDir,
    })
    const ts = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'tileset.json'), 'utf8'))
    const b = ts.root.boundingVolume.box
    expect(Math.abs(b[1])).toBeGreaterThan(500) // 北向
    expect(Math.abs(b[2])).toBeLessThan(100) // 地面高程（ENU 的 up）
    expect(b[11]).toBeLessThan(50) // 竖半轴：薄板，绝不能是 N 的量级
    expect(b[7]).toBeGreaterThan(500) // 北向半轴
  })
})

describe('buildAll — 产出的 GLB 必须自洽（Cesium 对无效 material / 越界 index 是静默丢弃）', () => {
  // 2026-10-03 实测的真缺陷：每座桥写自己的 GLB（内含 1 个 material），但 primitive 的
  // material 用了随桥递增的计数器 ⇒ 第 2 座起引用不存在的 material 1/2/3…，
  // Cesium 静默丢弃该 primitive ⇒ 瓦片内容永不 ready ⇒ 四座桥在页面上**零报错地不显示**。
  it('每个 primitive 的 material 索引存在、NORMAL/COLOR_0 与 POSITION 顶点数一致', () => {
    const dir = 'node_modules/.cache/beibu-bridges-test'
    fs.mkdirSync(dir, { recursive: true })
    const mk = (name, lon) => ({
      type: 'way',
      id: Math.round(lon * 1000),
      tags: { name, bridge: 'yes', highway: 'primary' },
      geometry: [
        { lon, lat: 21.94 },
        { lon: lon + 0.01, lat: 21.95 },
      ],
    })
    const osm = {
      elements: [mk('金海湾大桥', 108.6), mk('子材大桥', 108.63), mk('钦江大桥', 108.62)],
    }
    fs.writeFileSync(path.join(dir, 'osm.json'), JSON.stringify(osm))
    const anchors = {
      note: 'test fixture',
      bridges: {
        金海湾大桥: { surface_ell_m: -16, clearance_m: 19.3 },
        子材大桥: { surface_ell_m: -11, clearance_m: 19.3 },
        钦江大桥: { surface_ell_m: -16, clearance_m: 19.3 },
      },
    }
    fs.writeFileSync(path.join(dir, 'anchors.json'), JSON.stringify(anchors))
    buildAll({
      osmFile: path.join(dir, 'osm.json'),
      outDir: path.join(dir, 'out'),
      anchorsPath: path.join(dir, 'anchors.json'),
    })
    const files = fs.readdirSync(path.join(dir, 'out')).filter((f) => f.endsWith('.glb'))
    expect(files.length).toBeGreaterThanOrEqual(2)
    for (const f of files) {
      const buf = fs.readFileSync(path.join(dir, 'out', f))
      const jlen = buf.readUInt32LE(12)
      const j = JSON.parse(buf.subarray(20, 20 + jlen).toString('utf8'))
      for (const m of j.meshes || []) {
        for (const pr of m.primitives || []) {
          if (pr.material !== undefined) expect((j.materials || [])[pr.material]).toBeDefined()
          const pos = j.accessors[pr.attributes.POSITION]
          if (pr.attributes.NORMAL !== undefined)
            expect(j.accessors[pr.attributes.NORMAL].count).toBe(pos.count)
          if (pr.attributes.COLOR_0 !== undefined)
            expect(j.accessors[pr.attributes.COLOR_0].count).toBe(pos.count)
        }
      }
    }
  })
})

describe('buildAll — 五桥垂直锚（净高语义：桥面结构底缘 = 水面 + clearance）', () => {
  // 2026-10-05 实测：此前 u=22 被当作"比水面高 22 m"，但 ENU 锚在 h=0（椭球零面）⇒
  // 实际成了"比椭球 0 高 22 m"，五桥整体浮空 7~16 m、桥墩悬空 4.6~14.3 m
  // （探针 tools/diag/probe-bridge-vert.py）。本组钉锚点语义与 fail-loud。
  const readGLB = (buf) => {
    const jlen = buf.readUInt32LE(12)
    const json = JSON.parse(buf.subarray(20, 20 + jlen).toString('utf8'))
    let off = 20 + jlen
    while (off % 4 !== 0) off++
    const blen = buf.readUInt32LE(off)
    return { json, bin: buf.subarray(off + 8, off + 8 + blen) }
  }
  const readVec3 = ({ json, bin }, idx) => {
    const a = json.accessors[idx]
    const bv = json.bufferViews[a.bufferView]
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0)
    const out = []
    for (let i = 0; i < a.count; i++)
      out.push(
        bin.readFloatLE(base + i * 12),
        bin.readFloatLE(base + i * 12 + 4),
        bin.readFloatLE(base + i * 12 + 8)
      )
    return out
  }
  const fixture = () => {
    const dir = 'node_modules/.cache/beibu-bridges-anchor-test'
    fs.mkdirSync(dir, { recursive: true })
    const way = (name, lon, lat) => ({
      type: 'way',
      id: Math.round(lon * 1e5),
      tags: { name, bridge: 'yes', highway: 'primary' },
      geometry: [
        { lon, lat },
        { lon: lon + 0.001, lat: lat + 0.001 },
      ],
    })
    fs.writeFileSync(
      path.join(dir, 'osm.json'),
      JSON.stringify({
        elements: [
          way('子材大桥', 108.63, 21.97),
          // 远端桥：距锚点（子材中点）≈3.3 km——专门钉住 d²/2R 曲率补偿（裸切平面会多 +0.84 m）
          way('金海湾大桥', 108.6, 21.94),
        ],
      })
    )
    fs.writeFileSync(
      path.join(dir, 'anchors.json'),
      JSON.stringify({
        note: 'fixture',
        bridges: {
          子材大桥: { surface_ell_m: -11, clearance_m: 19.3 },
          金海湾大桥: { surface_ell_m: -16, clearance_m: 19.3 },
        },
      })
    )
    return dir
  }
  it('桥面底 = 水面+19.3、墩底入水；远端桥含曲率补偿；锚点写入 extras', () => {
    const dir = fixture()
    buildAll({
      osmFile: path.join(dir, 'osm.json'),
      outDir: path.join(dir, 'out'),
      anchorsPath: path.join(dir, 'anchors.json'),
    })
    // 桥面/墩的世界椭球高 ≈ 局部 u + d²/2R（锚点为切平面）；判据按世界高，与探针同口径
    const bucket = (file, color) => {
      const glb = readGLB(fs.readFileSync(path.join(dir, 'out', file)))
      const pr = glb.json.meshes[0].primitives[0]
      const pos = readVec3(glb, pr.attributes.POSITION)
      const col = readVec3(glb, pr.attributes.COLOR_0)
      const out = []
      for (let i = 0; i < col.length / 3; i++) {
        const [r, g, b] = [col[i * 3], col[i * 3 + 1], col[i * 3 + 2]]
        if (
          Math.abs(r - color[0]) < 1e-3 &&
          Math.abs(g - color[1]) < 1e-3 &&
          Math.abs(b - color[2]) < 1e-3
        ) {
          const [x, y, z] = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]
          out.push(y + (x * x + z * z) / (2 * 6371000))
        }
      }
      return out
    }
    const DECK = [0.72, 0.72, 0.74],
      PIER = [0.55, 0.55, 0.57]
    for (const [file, surf] of [
      ['zicai.glb', -11],
      ['jinhaiwan.glb', -16],
    ]) {
      const deck = bucket(file, DECK),
        pier = bucket(file, PIER)
      expect(deck.length).toBeGreaterThan(0)
      expect(pier.length).toBeGreaterThan(0)
      expect(Math.min(...deck)).toBeCloseTo(surf + 19.3, 1) // 桥面底=水面+净高
      expect(Math.max(...deck)).toBeCloseTo(surf + 19.3 + 2.5, 1) // 桥面顶=+板厚
      expect(Math.min(...pier)).toBeLessThanOrEqual(surf) // 墩底 ≤ 水面
    }
    const ts = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'tileset.json'), 'utf8'))
    expect(
      ts.root.children.find((c) => c.extras.name === '子材大桥').extras.verticalAnchor
    ).toMatchObject({
      surface_ell_m: -11,
      clearance_m: 19.3,
    })
  })
  it('缺锚点表 ⇒ 报错（fail-loud，不静默退回"椭球 0"锚）', () => {
    const dir = fixture()
    expect(() =>
      buildAll({
        osmFile: path.join(dir, 'osm.json'),
        outDir: path.join(dir, 'out2'),
        anchorsPath: path.join(dir, 'missing.json'),
      })
    ).toThrow(/锚点表/)
  })
})

describe('ground-ref — 参考地面（C 口径：4 m 格中位、r=48 m、地面带、超半径 null）', () => {
  // 合成夹具：rail 材质、2 m 步距铺 40×40 m 的两块瓦片——一块在带内 u=−16（应成格），
  // 一块在带外 u=+2（构筑物面，应被地面带 [−24,−12] 挡掉、不成格）。
  const fixture = () => {
    const dir = 'node_modules/.cache/beibu-groundref-test'
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'tileset.json'),
      JSON.stringify({ root: { transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } })
    )
    const positions = [],
      normals = [],
      colors = [],
      indices = []
    const axis = []
    for (let v = 0; v <= 40; v += 2) axis.push(v)
    const patch = (xOff, y) => {
      const base = positions.length / 3
      for (const x of axis) {
        for (const n of axis) {
          // glTF：x=E、y=U、z=−N（与交付包同口径）
          positions.push(xOff + x, y, -n)
          normals.push(0, 1, 0)
          colors.push(1, 1, 1)
        }
      }
      const idx = (ix, iz) => base + iz * axis.length + ix
      for (let iz = 0; iz < axis.length - 1; iz++) {
        for (let ix = 0; ix < axis.length - 1; ix++) {
          indices.push(
            idx(ix, iz),
            idx(ix + 1, iz),
            idx(ix, iz + 1),
            idx(ix + 1, iz),
            idx(ix + 1, iz + 1),
            idx(ix, iz + 1)
          )
        }
      }
    }
    patch(0, -16) // 带内（地面）
    patch(500, 2) // 带外（构筑物面：应被挡）
    fs.writeFileSync(
      path.join(dir, 't4_patch.glb'),
      buildGLB({
        meshes: [{ primitives: [{ positions, normals, colors, indices, material: 0 }] }],
        materials: [{ name: 'rail', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        nodes: [{ mesh: 0 }],
      })
    )
    return dir
  }
  it('带内格命中、半径边界、超半径 null；带外（构筑物 u=+2）不成格', () => {
    const ref = buildGroundRef({ tileDir: fixture() })
    expect(ref.stats.cells).toBeGreaterThan(0)
    expect(ref.stats.mats.rail).toBeGreaterThan(0)
    expect(ref.nearestU(1, 1)).toBeCloseTo(-16, 5)
    expect(ref.nearestU(38, 38)).toBeCloseTo(-16, 5)
    // 最远「成格」中心在带内patch的 (38,2)（边界少点格不足 3 点未建）：
    // 到 (85,0) 距离 ≈47.04 ≤ r 命中；到 (90,0) ≈52 > r 为 null
    expect(ref.nearestU(85, 0)).toBeCloseTo(-16, 5)
    expect(ref.nearestU(90, 0)).toBeNull()
    // 带外patch（E≈500..540）：一个格都不该建 ⇒ 查询为 null（构筑物面被地面带挡掉）
    expect(ref.nearestU(520, 20)).toBeNull()
    expect(ref.nearestU(1000, 1000)).toBeNull()
  })
})

describe('extrudeWay — C 口径逐角查询（null 回落常数）', () => {
  it('逐角 queryU：命中走参考+lift、未命中回落 groundU+lift', () => {
    const g = extrudeWay(
      [
        [0, 0],
        [100, 0],
      ],
      10,
      -20,
      0.15,
      (e) => (e < 50 ? -10 : null)
    )
    // 四角顺序：(x0+nx,y0+ny),(x1+nx,y1+ny),(x1−nx,y1−ny),(x0−nx,y0−ny)
    expect(g.positions[1]).toBeCloseTo(-10 + 0.15, 5) // 角 0（x0=0，命中）
    expect(g.positions[3 * 3 + 1]).toBeCloseTo(-10 + 0.15, 5) // 角 3（x0=0，命中）
    expect(g.positions[3 + 1]).toBeCloseTo(-20 + 0.15, 5) // 角 1（x1=100，回落）
    expect(g.positions[2 * 3 + 1]).toBeCloseTo(-20 + 0.15, 5) // 角 2（x1=100，回落）
  })
})

describe('buildGround — 作业区地面片', () => {
  // 三件事一起钉：① 水面格不铺（用户要连续，但不能连到海里去）；
  // ② 顶点是 glTF Y-up（平铺：y 恒定，轴序错时 y 会跨 N 的量级）；
  // ③ root.boundingVolume.box 是 ENU（Z-up）——第 3 分量是地面高程、竖半轴很小。
  it('水面格跳过；顶点平铺在 glTF y；盒是 ENU', () => {
    const dir = 'node_modules/.cache/beibu-ground-test'
    fs.mkdirSync(dir, { recursive: true })
    const size = 64
    const bbox = [108.64, 21.66, 108.66, 21.68]
    const bits = Buffer.alloc((size * size) / 8)
    // 东半为水面；位序与 loadWaterMask 一致（MSB first、行优先、行 0 在北）
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (x >= size / 2) {
          const i = y * size + x
          bits[i >> 3] |= 0x80 >> (i & 7)
        }
      }
    }
    fs.writeFileSync(
      path.join(dir, 'water-mask.json'),
      JSON.stringify({ note: 'test', bbox, size, bits: bits.toString('base64') })
    )
    fs.writeFileSync(path.join(dir, 'imagery.json'), JSON.stringify({ tiles: [{ bbox }] }))
    const tileDir = makePortTileFixture(dir)
    const r = buildGround({
      outDir: path.join(dir, 'out'),
      rebuiltDir: 'backend/static/qinzhou-port/rebuilt',
      maskFile: path.join(dir, 'water-mask.json'),
      imageryFile: path.join(dir, 'imagery.json'),
      cell: 20,
      tileDir,
    })
    expect(r.triangles).toBeGreaterThan(0)
    // 只铺了西半 ⇒ 铺格占比应落在 0.3~0.7（全铺=1.0、或一格不铺=0 都会红）
    expect(r.land / r.cells).toBeGreaterThan(0.3)
    expect(r.land / r.cells).toBeLessThan(0.7)

    const ts = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'tileset.json'), 'utf8'))
    const b = ts.root.boundingVolume.box
    expect(Math.abs(b[2])).toBeLessThan(200) // ENU 的 up 是第 3 分量
    expect(b[11]).toBeLessThan(50) // 竖半轴：薄板

    const glb = fs.readFileSync(path.join(dir, 'out', 'ground.glb'))
    const jlen = glb.readUInt32LE(12)
    const j = JSON.parse(glb.subarray(20, 20 + jlen).toString('utf8'))
    const acc = j.accessors[j.meshes[0].primitives[0].attributes.POSITION]
    expect(acc.min[1]).toBeCloseTo(acc.max[1], 6)
  })
})

describe('box — 单位盒', () => {
  it('12 三角面 / 24 顶点 / 6 个面法线', () => {
    const b = box(2, 4, 6)
    expect(b.indices.length).toBe(36)
    expect(b.positions.length / 3).toBe(24)
    expect(b.normals.length / 3).toBe(24)
  })

  it('尺寸精确：max-min 等于入参', () => {
    const b = box(2, 4, 6)
    const xs = b.positions.filter((_, i) => i % 3 === 0)
    const ys = b.positions.filter((_, i) => i % 3 === 1)
    const zs = b.positions.filter((_, i) => i % 3 === 2)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2, 6)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(4, 6)
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(6, 6)
  })
})

describe('buildGLB — 结构自洽', () => {
  const mk = () => {
    const g = box(1, 1, 1)
    return buildGLB({
      meshes: [{ primitives: [{ ...g, material: 0 }] }],
      materials: [{ name: 't', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
    })
  }

  it('魔数 / 版本 / 总长与实际字节数一致', () => {
    const glb = mk()
    expect(glb.readUInt32LE(0)).toBe(0x46546c67)
    expect(glb.readUInt32LE(4)).toBe(2)
    expect(glb.readUInt32LE(8)).toBe(glb.length)
  })

  it('两个 chunk 类型正确且 4 字节对齐', () => {
    const glb = mk()
    const jlen = glb.readUInt32LE(12)
    expect(glb.readUInt32LE(16)).toBe(0x4e4f534a)
    expect(jlen % 4).toBe(0)
    const boff = 20 + jlen
    const blen = glb.readUInt32LE(boff)
    expect(glb.readUInt32LE(boff + 4)).toBe(0x004e4942)
    expect(blen % 4).toBe(0)
    expect(boff + 8 + blen).toBe(glb.length)
  })

  it('POSITION accessor 的 count×12 与 bufferView 长度相等', () => {
    const glb = mk()
    const jlen = glb.readUInt32LE(12)
    const json = JSON.parse(glb.subarray(20, 20 + jlen).toString('utf8'))
    const posAcc = json.accessors[json.meshes[0].primitives[0].attributes.POSITION]
    expect(posAcc.type).toBe('VEC3')
    expect(posAcc.componentType).toBe(5126)
    const bv = json.bufferViews[posAcc.bufferView]
    expect(bv.byteLength).toBe(posAcc.count * 12)
    expect(bv.byteLength % 4).toBe(0)
  })

  it('indices 最大值 < 顶点数（越界会被 Cesium 静默丢弃）', () => {
    const glb = mk()
    const jlen = glb.readUInt32LE(12)
    const json = JSON.parse(glb.subarray(20, 20 + jlen).toString('utf8'))
    const prim = json.meshes[0].primitives[0]
    const verts = json.accessors[prim.attributes.POSITION].count
    const idxAcc = json.accessors[prim.indices]
    const boff = 20 + jlen
    const binStart = boff + 8
    const bv = json.bufferViews[idxAcc.bufferView]
    const base = binStart + (bv.byteOffset ?? 0)
    let mx = -1
    for (let i = 0; i < idxAcc.count; i++) {
      const v =
        idxAcc.componentType === 5123
          ? glb.readUInt16LE(base + i * 2)
          : glb.readUInt32LE(base + i * 4)
      if (v > mx) mx = v
    }
    expect(mx).toBeLessThan(verts)
  })

  it('实例化节点带 EXT_mesh_gpu_instancing 且 extensionsUsed 已声明', () => {
    const g = box(1, 1, 1)
    const glb = buildGLB({
      meshes: [{ primitives: [{ ...g, material: 0 }] }],
      nodes: [
        {
          mesh: 0,
          instancing: { translation: [1, 2, 3, 4, 5, 6], rotation: [0, 0, 0, 1, 0, 0, 0, 1] },
        },
      ],
    })
    const jlen = glb.readUInt32LE(12)
    const json = JSON.parse(glb.subarray(20, 20 + jlen).toString('utf8'))
    expect(json.extensionsUsed).toContain('EXT_mesh_gpu_instancing')
    const ext = json.nodes[0].extensions.EXT_mesh_gpu_instancing
    expect(json.accessors[ext.attributes.TRANSLATION].count).toBe(2)
    expect(json.accessors[ext.attributes.ROTATION].count).toBe(2)
    expect(json.accessors[ext.attributes.ROTATION].type).toBe('VEC4')
  })
})

describe('CONTAINER_TYPES — 箱型表', () => {
  it('5 款且 key 唯一', () => {
    expect(CONTAINER_TYPES).toHaveLength(5)
    expect(new Set(CONTAINER_TYPES.map((t) => t.key)).size).toBe(5)
  })

  it('尺寸落在 ISO 668 标准值上（长 6.058/12.192，宽 2.438，高 2.591/2.896）', () => {
    for (const t of CONTAINER_TYPES) {
      expect([6.058, 12.192]).toContain(t.len)
      expect(t.wid).toBeCloseTo(2.438, 6)
      expect([2.591, 2.896]).toContain(t.hei)
    }
  })

  it('generateAll 每款都能写出可解析的 GLB（含 20ft/40ft/高柜/冷藏/开顶）', () => {
    const out = 'node_modules/.cache/beibu-container-models-test'
    const rows = generateAll(out)
    expect(rows).toHaveLength(5)
    for (const r of rows) {
      expect(r.tris).toBeGreaterThan(0)
      expect(r.bytes).toBeGreaterThan(100)
    }
  })
})
