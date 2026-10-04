#!/usr/bin/env node
/**
 * glb-read.mjs — 最小 GLB **读**器（只读 POSITION 的竖直分量与材质名）。
 *
 * 为什么需要：作业区地面高程基准必须从**交付包的几何**派生，而不是从我们自己的分桶盒反算
 * （2026-08-04 实测：分桶盒底比真实场地低 4.7 m，路网整层埋在交付包表面下）。
 * 只做这一件事，不引第三方库（与 glb.mjs 写器对称）。
 */
import fs from 'node:fs'

const CS = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

export function readGLB(file) {
  const buf = fs.readFileSync(file)
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not glb: ' + file)
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
  if (!json || !bin) throw new Error('glb 缺 chunk: ' + file)
  return { json, bin }
}

/** 收集某材质所有 POSITION 的**竖直分量**（glTF Y-up ⇒ y 就是高度）。材质名不匹配则返回空数组。 */
export function heightsOfMaterial(json, bin, matName, maxSamples = 4000) {
  const out = []
  for (const m of json.meshes ?? []) {
    for (const pr of m.primitives ?? []) {
      const mn = json.materials?.[pr.material]?.name ?? '(none)'
      if (mn !== matName) continue
      const a = json.accessors[pr.attributes.POSITION]
      if (!a) continue
      const bv = json.bufferViews[a.bufferView]
      const nc = NC[a.type]
      const sz = CS[a.componentType]
      const stride = bv.byteStride || sz * nc
      const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0)
      const step = Math.max(1, Math.floor(a.count / maxSamples))
      for (let i = 0; i < a.count; i += step) out.push(bin.readFloatLE(base + i * stride + sz))
    }
  }
  return out
}

export function median(arr) {
  if (!arr.length) return NaN
  const s = arr.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
