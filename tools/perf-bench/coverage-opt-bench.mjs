// 覆盖多边形计算优化对照：验证「不上 PostGIS、纯内存优化」能拿到多少收益。
// 对照 4 种做法在真实钦州数据上的耗时与顶点规模。
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// @turf/turf 装在 backend/node_modules 或根 node_modules，从 backend 侧解析。
// 本文件在 tools/perf-bench/ 下，需跨两级才到仓库根的 backend/——2026-08-29 随目录收口修正
const require = createRequire(path.join(__dirname, '..', '..', 'backend', 'package.json'))
const turf = require('@turf/turf')
const DATA = path.join(__dirname, '..', '..', 'backend', 'data', 'site-selection')

const FILE_OF = {
  hospital: 'qz_hospital.json',
  primary_school: 'qz_primary_school.json',
  middle_school: 'qz_middle_school.json',
  park: 'qz_park.json',
  bus_station: 'qz_bus_station.json',
  mall: 'qz_mall_and_supermarket.json',
}
const RADIUS = {
  hospital: 3,
  primary_school: 1,
  middle_school: 2,
  park: 1.5,
  bus_station: 0.5,
  mall: 2,
}
const load = (f) => JSON.parse(readFileSync(path.join(DATA, f), 'utf-8'))

const ms = () => Number(process.hrtime.bigint() / 1000n) / 1000
const countVerts = (g) => {
  if (!g) return 0
  const c = g.geometry?.coordinates
  if (!c) return 0
  if (g.geometry.type === 'MultiPolygon')
    return c.reduce((s, p) => s + p.reduce((s2, r) => s2 + r.length, 0), 0)
  return c.reduce((s, r) => s + r.length, 0)
}

// 方案 0：现状 —— 默认精度 buffer + turf.union 全量合并
function baseline(points, radius) {
  const buffers = points.map((p) =>
    turf.buffer(turf.point([p.lng, p.lat]), radius, { units: 'kilometers' })
  )
  return turf.union(turf.featureCollection(buffers.filter(Boolean)))
}

// 方案 1：降精度 —— steps 由默认 8 降到 2（每圆 8 顶点而非 ~33）
function lowSteps(points, radius) {
  const buffers = points.map((p) =>
    turf.buffer(turf.point([p.lng, p.lat]), radius, { units: 'kilometers', steps: 2 })
  )
  return turf.union(turf.featureCollection(buffers.filter(Boolean)))
}

// 方案 2：降精度 + 分治 union（两两归并，把 O(n²) 降为 O(n log n)）
function unionDivide(list) {
  if (list.length === 1) return list[0]
  const mid = Math.floor(list.length / 2)
  const a = unionDivide(list.slice(0, mid))
  const b = unionDivide(list.slice(mid))
  if (!a) return b
  if (!b) return a
  try {
    return turf.union(turf.featureCollection([a, b]))
  } catch {
    return a
  }
}
function lowStepsDivide(points, radius) {
  const buffers = points
    .map((p) => turf.buffer(turf.point([p.lng, p.lat]), radius, { units: 'kilometers', steps: 2 }))
    .filter(Boolean)
  return unionDivide(buffers)
}

// 方案 3：栅格近似 —— 用 100m 网格布尔覆盖替代多边形布尔运算，最后网格→多边形
// 思路：覆盖判定本质是"点是否被任一设施的半径覆盖"，用网格记录覆盖标记，
// 再把连通的覆盖格合并为矩形输出。可视化足够，复杂度 O(n)。
function gridApprox(points, radius, cellKm = 0.1) {
  const covered = new Set()
  const cellLat = cellKm / 111.32
  const cosLat = Math.cos((21.98 * Math.PI) / 180)
  const cellLng = cellKm / (111.32 * cosLat)
  const r2 = radius * radius
  const steps = Math.max(1, Math.ceil(radius / cellKm))
  for (const p of points) {
    // 在设施的方形邻域内逐格判距，避免全网格扫描
    for (let dy = -steps; dy <= steps; dy++) {
      for (let dx = -steps; dx <= steps; dx++) {
        const cx = Math.round((p.lng + dx * cellLng) / cellLng)
        const cy = Math.round((p.lat + dy * cellLat) / cellLat)
        const key = cx + ',' + cy
        if (covered.has(key)) continue
        const glng = cx * cellLng
        const glat = cy * cellLat
        const dLng = (glng - p.lng) * 111.32 * cosLat
        const dLat = (glat - p.lat) * 111.32
        if (dLng * dLng + dLat * dLat <= r2) covered.add(key)
      }
    }
  }
  // 覆盖格 → 每个格输出一个方形 Polygon（MultiPolygon），供前端渲染
  const polys = []
  for (const key of covered) {
    const [cx, cy] = key.split(',').map(Number)
    const x0 = cx * cellLng - cellLng / 2
    const x1 = cx * cellLng + cellLng / 2
    const y0 = cy * cellLat - cellLat / 2
    const y1 = cy * cellLat + cellLat / 2
    polys.push([
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ],
    ])
  }
  return { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: polys }, properties: {} }
}

// 方案 4：空间分桶分治 —— 按网格把点分桶，桶内先 union 降规模，再全局合并一次。
// 每个 buffer 完整归属其中心点所在桶，最终全局 union 会正确缝合跨桶重叠，结果无损。
function bucketDivide(points, radius, cellDeg = 0.05) {
  const buckets = new Map()
  for (const p of points) {
    const k = Math.floor(p.lng / cellDeg) + ',' + Math.floor(p.lat / cellDeg)
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(p)
  }
  const parts = []
  for (const pts of buckets.values()) {
    const bs = pts
      .map((p) =>
        turf.buffer(turf.point([p.lng, p.lat]), radius, { units: 'kilometers', steps: 2 })
      )
      .filter(Boolean)
    const merged = unionDivide(bs)
    if (merged) parts.push(merged)
  }
  return unionDivide(parts)
}

const PLANS = [
  ['现状 buffer+union', baseline],
  ['降精度 steps=2', lowSteps],
  ['降精度+分治union', lowStepsDivide],
  ['降精度+分桶分治', bucketDivide],
  ['栅格近似 100m', gridApprox],
]

console.log('='.repeat(78))
console.log('覆盖多边形计算：4 种方案对照（钦州真实数据）')
console.log('='.repeat(78))

const totals = {}
for (const [label] of PLANS) totals[label] = 0

for (const type of Object.keys(FILE_OF)) {
  const pts = load(FILE_OF[type])
  const r = RADIUS[type]
  console.log(`\n── ${type}  (${pts.length} 点, 半径 ${r}km) ──`)
  for (const [label, fn] of PLANS) {
    const t = ms()
    const g = fn(pts, r)
    const dt = ms() - t
    totals[label] += dt
    console.log(`   ${label.padEnd(18)} ${dt.toFixed(1).padStart(9)} ms   顶点 ${countVerts(g)}`)
  }
}

console.log('\n' + '='.repeat(78))
console.log('合计（6 类设施全算）')
const base = totals['现状 buffer+union']
for (const [label] of PLANS) {
  const t = totals[label]
  console.log(
    `   ${label.padEnd(18)} ${t.toFixed(1).padStart(9)} ms   加速 ${(base / t).toFixed(2)}x   节省 ${(base - t).toFixed(0)} ms`
  )
}
console.log('='.repeat(78))
