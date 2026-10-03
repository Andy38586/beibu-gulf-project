#!/usr/bin/env node
/**
 * 摘掉交付包里原有的集装箱图元（cargo 材质），产出「清空版」瓦片。
 *
 * ## 为什么必须摘
 *
 * 新建的集装箱层（rebuild-containers.mjs）与原包的 cargo 棱柱**占同一位置**。
 * 不摘就是本项目已经踩过一次的坑：同一位置渲染两套互相穿插的模型
 * （三条 BIM 枢纽就是这样被移除的，见 beibu3dTiles 文件头）。
 *
 * ## 做法：重建而非打补丁
 *
 * 不是从 mesh.primitives 里删几项就完事——那样 accessor/bufferView/buffer 里的
 * 字节仍在，t5_544_672.glb 实测 8.92 MB 里绝大部分是 cargo，删了索引不减体积。
 * 故按「保留的 primitive」重新装配 accessor/bufferView/buffer，material 表同步重排。
 *
 * 用法：node tools/3dtiles-build/clean-cargo.mjs [--out 目录]
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildGLB } from './glb.mjs'

const TILE_DIR = 'backend/static/qinzhou-port/tiles'
/** 要摘的材质名（实测交付包里集装箱统一用 cargo） */
const DROP_MATERIALS = new Set(['cargo'])

const CS = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

function readGLB(p) {
  const buf = fs.readFileSync(p)
  let off = 12,
    json = null,
    bin = null
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off),
      type = buf.readUInt32LE(off + 4)
    const d = buf.subarray(off + 8, off + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(d.toString('utf8'))
    else if (type === 0x004e4942) bin = d
    off += 8 + len + ((4 - (len % 4)) % 4)
  }
  return { json, bin }
}

function readAccessor(j, bin, ai) {
  const a = j.accessors[ai],
    bv = j.bufferViews[a.bufferView]
  const nc = NC[a.type],
    sz = CS[a.componentType]
  const stride = bv.byteStride || sz * nc
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0)
  const out = new Array(a.count * nc)
  const rd = (o) =>
    a.componentType === 5126
      ? bin.readFloatLE(o)
      : a.componentType === 5125
        ? bin.readUInt32LE(o)
        : a.componentType === 5123
          ? bin.readUInt16LE(o)
          : a.componentType === 5122
            ? bin.readInt16LE(o)
            : a.componentType === 5120
              ? bin.readInt8(o)
              : bin.readUInt8(o)
  for (let i = 0; i < a.count; i++)
    for (let c = 0; c < nc; c++) out[i * nc + c] = rd(base + i * stride + c * sz)
  return { data: out, nc, count: a.count, componentType: a.componentType, type: a.type }
}

/** 摘掉 cargo 后重建一个 GLB；返回 { buffer, kept, dropped, tris } */
export function cleanTile(file) {
  const { json, bin } = readGLB(file)
  const keptMaterials = []
  const matIndex = new Map()
  const meshes = []
  let kept = 0,
    dropped = 0,
    tris = 0

  for (const m of json.meshes ?? []) {
    const prims = []
    for (const pr of m.primitives ?? []) {
      const name = json.materials?.[pr.material]?.name ?? ''
      if (DROP_MATERIALS.has(name)) {
        dropped++
        continue
      }
      kept++
      const pos = readAccessor(json, bin, pr.attributes.POSITION)
      const nrm =
        pr.attributes.NORMAL !== undefined ? readAccessor(json, bin, pr.attributes.NORMAL) : null
      const col =
        pr.attributes.COLOR_0 !== undefined ? readAccessor(json, bin, pr.attributes.COLOR_0) : null
      const idx = pr.indices !== undefined ? readAccessor(json, bin, pr.indices) : null
      if (!matIndex.has(pr.material)) {
        matIndex.set(pr.material, keptMaterials.length)
        keptMaterials.push(
          json.materials?.[pr.material] ?? {
            pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1] },
          }
        )
      }
      const indices = idx ? idx.data : Array.from({ length: pos.count }, (_, i) => i)
      tris += indices.length / 3
      const prim = {
        positions: pos.data,
        indices,
        material: matIndex.get(pr.material),
      }
      if (nrm) prim.normals = nrm.data
      if (col) prim.colors = col.data
      prims.push(prim)
    }
    if (prims.length) meshes.push({ primitives: prims })
  }
  if (!meshes.length) return { buffer: null, kept, dropped, tris: 0 }
  return {
    buffer: buildGLB({ meshes, materials: keptMaterials }),
    kept,
    dropped,
    tris,
  }
}

/** 对整包执行：只清作业区内的瓦片，其余原样（返回「清空版」tileset.json） */
export function cleanTileset({ tileDir, outDir }) {
  fs.mkdirSync(outDir, { recursive: true })
  const src = path.join(tileDir, 'tileset.json')
  const ts = JSON.parse(fs.readFileSync(src, 'utf8'))
  const report = []
  const walk = (n) => {
    if (n.content?.uri) {
      const fp = path.join(tileDir, n.content.uri)
      if (fs.existsSync(fp)) {
        const r = cleanTile(fp)
        if (r.dropped > 0 && r.buffer) {
          fs.writeFileSync(path.join(outDir, n.content.uri), r.buffer)
          n.content.uri = 'clean/' + n.content.uri
          report.push({
            tile: n.content.uri,
            kept: r.kept,
            dropped: r.dropped,
            tris: r.tris,
            bytes: r.buffer.length,
          })
        }
      }
    }
    ;(n.children ?? []).forEach(walk)
  }
  walk(ts.root)
  // 未清理的瓦片仍指回原目录（相对 clean/ 的上一级）
  const fix = (n) => {
    if (n.content?.uri && !n.content.uri.startsWith('clean/'))
      n.content.uri = '../tiles/' + n.content.uri
    ;(n.children ?? []).forEach(fix)
  }
  fix(ts.root)
  const outFile = path.join(outDir, '..', 'tileset.cleaned.json')
  fs.writeFileSync(outFile, JSON.stringify(ts))
  return { report, outFile }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--out')
  const outDir = i > 0 ? process.argv[i + 1] : 'backend/static/qinzhou-port/rebuilt/clean'
  const { report, outFile } = cleanTileset({ tileDir: TILE_DIR, outDir })
  console.log('清理瓦片 ' + report.length + ' 个：')
  console.log('  瓦片             保留图元  摘除  三角面     字节')
  for (const r of report) {
    console.log(
      '  ' +
        r.tile.replace('clean/', '').padEnd(16) +
        String(r.kept).padStart(6) +
        String(r.dropped).padStart(6) +
        String(Math.round(r.tris)).padStart(9) +
        String(r.bytes).padStart(9)
    )
  }
  console.log('\n写出 ' + outFile)
}
