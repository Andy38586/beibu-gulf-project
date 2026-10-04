/* probe-flood-earcut.cjs — "带洞的档位多边形能不能被 earcut 正确三角化"的化验器（只读）。
 *
 * 背景（2026-10-04）：flood_engine.mask_to_geojson 之所以填洞，注释给的理由是
 * "渲染时外环覆盖海面、hole 挖空不完全"。修洞过滤（LinearRing.area 恒 0，见
 * probe-flood-polygon-variants.py 头注）前必须知道这个理由今天还成不成立——
 * 本脚本用前端同款依赖（node_modules/earcut，Cesium 的三角化后端）实测：
 *   ① 是否抛异常；② 三角化面积 vs 外环−洞（相对误差）；③ 三角数与耗时。
 *
 * 输入（两段式，都可复跑）：
 *   backend/algorithm-service/.venv/Scripts/python.exe -X utf8 \
 *     tools/diag/probe-flood-polygon-variants.py 5.0 --dump-earcut .local/flood-recompute/earcut-input.json
 *   node tools/diag/probe-flood-earcut.cjs [json路径]
 *
 * 2026-10-04 实跑（level 5.0m，UTM 米坐标）：
 *   B（30m 全分辨率 + 留大洞）：22 件｜232 洞｜194,945 三角｜276 ms｜误差 0.000%
 *   B300（生产口径 300m 简化 + 留大洞）：22 件｜199 洞｜9,011 三角｜12 ms｜误差 0.000%
 *   C（全留洞）：22 件｜6,134 洞｜284,489 三角｜4.8~7.1 s｜误差 0.000%
 * ⇒ "hole 挖空不完全"在 earcut 这层不成立；代价只体现在洞数上：留大洞 ≈12ms，
 *    全留洞 ≈5~7s（不可接受）。
 */
'use strict'
const fs = require('fs')
const path = require('path')
const _earcut = require('earcut')
const earcut = _earcut.default ?? _earcut

const ROOT = path.resolve(__dirname, '..', '..')
const FILE = process.argv[2] || path.join(ROOT, '.local/flood-recompute/earcut-input.json')
const DATA = JSON.parse(fs.readFileSync(FILE, 'utf8'))

const signedArea = (ring) => {
  let s = 0
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  return s / 2
}

for (const [variant, polys] of Object.entries(DATA)) {
  let tAll = 0
  let triAll = 0
  let worst = 0
  let worstIdx = -1
  let nHoles = 0
  let err = null
  for (let k = 0; k < polys.length; k++) {
    const p = polys[k]
    const verts = []
    const holes = []
    const push = (ring) => {
      for (const [x, y] of ring) verts.push(x, y)
    }
    push(p.outer)
    for (const h of p.holes) {
      holes.push(verts.length / 2)
      push(h)
    }
    nHoles += p.holes.length
    const t0 = process.hrtime.bigint()
    let idx
    try {
      idx = earcut(verts, holes, 2)
    } catch (e) {
      err = `part#${k} 抛异常 ${e.message}`
      break
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6
    tAll += ms
    triAll += idx.length / 3
    let triArea = 0
    for (let i = 0; i < idx.length; i += 3) {
      const [a, b, c] = [idx[i] * 2, idx[i + 1] * 2, idx[i + 2] * 2]
      triArea +=
        Math.abs(
          (verts[b] - verts[a]) * (verts[c + 1] - verts[a + 1]) -
            (verts[c] - verts[a]) * (verts[b + 1] - verts[a + 1])
        ) / 2
    }
    const expect =
      Math.abs(signedArea(p.outer)) - p.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0)
    const rel = Math.abs(triArea - expect) / Math.max(expect, 1)
    if (rel > worst) {
      worst = rel
      worstIdx = k
    }
  }
  if (err) {
    console.log(`${variant}: ${err}`)
    continue
  }
  console.log(
    `${variant}: ${polys.length} 件 ｜ 洞 ${nHoles} ｜ 三角 ${triAll} ｜ 耗时 ${tAll.toFixed(0)} ms ｜ ` +
      `最差面积相对误差 ${(worst * 100).toFixed(3)}%（part#${worstIdx}）`
  )
}
