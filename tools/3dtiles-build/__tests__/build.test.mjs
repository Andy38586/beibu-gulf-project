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

import { CONTAINER_TYPES, generateAll } from '../container-models.mjs'
import { box, buildGLB, enuToGltf } from '../glb.mjs'
import { buildRoads, extrudeWay } from '../build-roads.mjs'
import { ribbon } from '../build-canal.mjs'
import { buildBridge } from '../build-bridges.mjs'

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
    buildRoads({
      osmFile: path.join(dir, 'osm.json'),
      outDir: path.join(dir, 'out'),
      rebuiltDir: 'backend/static/qinzhou-port/rebuilt',
    })
    const ts = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'tileset.json'), 'utf8'))
    const b = ts.root.boundingVolume.box
    expect(Math.abs(b[1])).toBeGreaterThan(500) // 北向
    expect(Math.abs(b[2])).toBeLessThan(100) // 地面高程（ENU 的 up）
    expect(b[11]).toBeLessThan(50) // 竖半轴：薄板，绝不能是 N 的量级
    expect(b[7]).toBeGreaterThan(500) // 北向半轴
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
