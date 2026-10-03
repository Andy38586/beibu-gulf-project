// 3D Tiles 构建工具测试（glb 写出器 + 集装箱建模 + 放置）。
//
// 钉死三件事：
//   ① **坐标换算**：tile ENU(E,N,U) → glTF(x,y,z) 必须是 (E, U, −N)。写错的表现是
//      整层箱子平躺或镜像，不是"少几个箱子"——最难从渲染图上看出来的一类错。
//   ② **GLB 结构自洽**：accessor.count 与 bufferView 长度、indices 最大值与顶点数
//      必须对得上；Cesium 对越界 indices 是静默丢弃，不报错。
//   ③ **实例化确实被用上**：节点必须带 EXT_mesh_gpu_instancing 且 extensionsUsed 声明它。
//      少了这条声明 Cesium 会忽略扩展 ⇒ 箱子全堆在原点。
import { describe, expect, it } from 'vitest'

import { CONTAINER_TYPES, generateAll } from '../container-models.mjs'
import { enuToGltf } from '../rebuild-containers.mjs'
import { box, buildGLB } from '../glb.mjs'

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
