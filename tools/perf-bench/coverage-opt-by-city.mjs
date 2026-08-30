// 覆盖多边形计算优化对照（北海数据 = 当前最坏情况）
// 对照：现状 / 降精度 / 降精度+分治 / 栅格+行合并
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(path.join(__dirname, '..', '..', 'backend', 'package.json'))
const turf = require('@turf/turf')

const DATA = path.join(__dirname, '..', '..', 'backend', 'data', 'site-selection')
const CITY = process.argv[2] || 'bh'
const TYPES = ['hospital', 'primary_school', 'middle_school', 'park', 'bus_station', 'mall']
const RADIUS = {
  hospital: 3,
  primary_school: 1,
  middle_school: 2,
  park: 1.5,
  bus_station: 0.5,
  mall: 2,
}
const load = (t) => JSON.parse(readFileSync(path.join(DATA, `${CITY}_${t}.json`), 'utf-8'))

const ms = () => Number(process.hrtime.bigint() / 1000n) / 1000
const verts = (g) => {
  if (!g?.geometry?.coordinates) return 0
  const c = g.geometry.coordinates
  return g.geometry.type === 'MultiPolygon'
    ? c.reduce((s, p) => s + p.reduce((s2, r) => s2 + r.length, 0), 0)
    : c.reduce((s, r) => s + r.length, 0)
}

const baseline = (pts, r) =>
  turf.union(
    turf.featureCollection(
      pts.map((p) => turf.buffer(turf.point([p.lng, p.lat]), r, { units: 'kilometers' }))
    )
  )

const lowSteps = (pts, r) =>
  turf.union(
    turf.featureCollection(
      pts.map((p) => turf.buffer(turf.point([p.lng, p.lat]), r, { units: 'kilometers', steps: 2 }))
    )
  )

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
const lowDivide = (pts, r) =>
  unionDivide(
    pts.map((p) => turf.buffer(turf.point([p.lng, p.lat]), r, { units: 'kilometers', steps: 2 }))
  )

// 栅格覆盖 + 行合并（run-length）：同一行连续覆盖格合并为一个矩形，
// 再把纵向相邻且列范围相同的矩形合并，显著压低顶点数。
function gridCoverage(pts, r, cellKm = 0.1) {
  const covered = new Set()
  const cellLat = cellKm / 111.32
  const cosLat = Math.cos((21.7 * Math.PI) / 180)
  const cellLng = cellKm / (111.32 * cosLat)
  const r2 = r * r
  const steps = Math.max(1, Math.ceil(r / cellKm))
  for (const p of pts) {
    const cx0 = Math.round(p.lng / cellLng)
    const cy0 = Math.round(p.lat / cellLat)
    for (let dy = -steps; dy <= steps; dy++) {
      for (let dx = -steps; dx <= steps; dx++) {
        const key = cx0 + dx + ',' + (cy0 + dy)
        if (covered.has(key)) continue
        const glng = (cx0 + dx) * cellLng
        const glat = (cy0 + dy) * cellLat
        const dLng = (glng - p.lng) * 111.32 * cosLat
        const dLat = (glat - p.lat) * 111.32
        if (dLng * dLng + dLat * dLat <= r2) covered.add(key)
      }
    }
  }
  // 按行聚合连续区间
  const rows = new Map()
  for (const key of covered) {
    const [cx, cy] = key.split(',').map(Number)
    if (!rows.has(cy)) rows.set(cy, [])
    rows.get(cy).push(cx)
  }
  const rects = []
  for (const [cy, xs] of rows) {
    xs.sort((a, b) => a - b)
    let start = xs[0],
      prev = xs[0]
    for (let i = 1; i <= xs.length; i++) {
      if (i < xs.length && xs[i] === prev + 1) {
        prev = xs[i]
        continue
      }
      rects.push([start, prev, cy]) // [cx起, cx止, cy]
      if (i < xs.length) {
        start = xs[i]
        prev = xs[i]
      }
    }
  }
  // 纵向合并：相邻行且列范围相同 → 拉高
  rects.sort((a, b) => a[2] - b[2] || a[0] - b[0])
  const merged = []
  for (const rc of rects) {
    const last = merged[merged.length - 1]
    if (last && last[0] === rc[0] && last[1] === rc[1] && last[3] === rc[2] - 1) last[3] = rc[2]
    else merged.push([rc[0], rc[1], rc[2], rc[2]])
  }
  const polys = merged.map(([x0, x1, y0, y1]) => {
    const a = x0 * cellLng - cellLng / 2,
      b = (x1 + 1) * cellLng - cellLng / 2
    const c = y0 * cellLat - cellLat / 2,
      d = (y1 + 1) * cellLat - cellLat / 2
    return [
      [
        [a, c],
        [b, c],
        [b, d],
        [a, d],
        [a, c],
      ],
    ]
  })
  return { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: polys }, properties: {} }
}

const PLANS = [
  ['现状 buffer+union', baseline],
  ['降精度 steps=2', lowSteps],
  ['降精度+分治union', lowDivide],
  ['栅格100m+行合并', gridCoverage],
]

console.log('='.repeat(74))
console.log(`覆盖多边形优化对照 —— ${CITY}（最坏情况优先）`)
console.log('='.repeat(74))
const totals = Object.fromEntries(PLANS.map(([l]) => [l, 0]))

for (const t of TYPES) {
  const pts = load(t),
    r = RADIUS[t]
  console.log(`\n── ${t} (${pts.length} 点, ${r}km) ──`)
  for (const [label, fn] of PLANS) {
    const s = ms()
    const g = fn(pts, r)
    const dt = ms() - s
    totals[label] += dt
    console.log(`   ${label.padEnd(18)} ${dt.toFixed(0).padStart(7)} ms   顶点 ${verts(g)}`)
  }
}
console.log('\n' + '='.repeat(74))
console.log('6 类合计')
const base = totals['现状 buffer+union']
for (const [label] of PLANS) {
  const t = totals[label]
  console.log(
    `   ${label.padEnd(18)} ${t.toFixed(0).padStart(7)} ms   加速 ${(base / t).toFixed(2)}x`
  )
}
console.log('='.repeat(74))
