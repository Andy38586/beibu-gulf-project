/**
 * glb-read.mjs — 交付包地面高程取数（只读 POSITION 的竖直分量与材质名）。
 *
 * 为什么需要：作业区地面高程基准必须从**交付包的几何**派生，而不是从我们自己的分桶盒反算
 * （2026-08-04 实测：分桶盒底比真实场地低 4.7 m，路网整层埋在交付包表面下）。
 * 读链本体已收口到 tools/lib/glb.mjs；这里只留取数口径，readGLB 原样转发给既有消费者。
 */
import { accessor, readGLB } from '../lib/glb.mjs'

export { readGLB }

/** 收集某材质所有 POSITION 的**竖直分量**（glTF Y-up ⇒ y 就是高度）。材质名不匹配则返回空数组。 */
export function heightsOfMaterial(json, bin, matName, maxSamples = 4000) {
  const out = []
  for (const m of json.meshes ?? []) {
    for (const pr of m.primitives ?? []) {
      const mn = json.materials?.[pr.material]?.name ?? '(none)'
      if (mn !== matName) continue
      const ai = pr.attributes.POSITION
      if (ai === undefined) continue
      const p = accessor(json, bin, ai) // VEC3 ⇒ 每顶点 3 个分量
      const n = p.length / 3
      const step = Math.max(1, Math.floor(n / maxSamples))
      for (let i = 0; i < n; i += step) out.push(p[i * 3 + 1])
    }
  }
  return out
}

export function median(arr) {
  if (!arr.length) return NaN
  const s = arr.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
