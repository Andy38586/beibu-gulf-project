/* lod-bytes-join.cjs — 把 lod-ladder 探针落下的「选中瓦片文件名」回连交付包磁盘字节，
 * 产出 资产×距离档 的 形态/sel/tri/主体px/选中字节约MB 表（任务表 §8.29 N6 决策表原始数据）。
 *
 * 口径（与 §8.29 正文一致，改口径必须两处同改）：
 *  - 输入两份：探针产物 .local/3d-review/lod-ladder/lod-ladder.json（每行 layer.tiles = 该层
 *    Cesium _selectedTiles 的 tail 文件名，存前 12 个）+ 盘上交付包 backend/static/。
 *  - 同名件可能多份（qinzhou-port/tiles 服务件 vs rebuilt/clean 重建工作副本，实测差 5.8×）
 *    ——永远取**线上实际服务的那份**（路径含 pinglu/tiles/ 或 qinzhou-port/tiles/）；
 *    服务件仍有多份时把该行标 ambiguous 并在 stdout 点名，禁止默认取值。
 *  - truncated = 该行 tiles 存满 12 个（字节和可能少算）；missing = 盘上找不到，EXIT=1。
 *
 * 用法：node tools/diag/lod-ladder.cjs <url> <heights> && node tools/diag/lod-bytes-join.cjs
 * 只读：不改源码、不改 tileset；输出只落 .local/。
 */
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const JSON_PATH = path.join(ROOT, '.local', '3d-review', 'lod-ladder', 'lod-ladder.json')
const OUT = path.join(ROOT, '.local', '3d-review', 'lod-ladder', 'lod-bytes.json')
const ROOTS = [
  path.join(ROOT, 'backend', 'static', 'pinglu'),
  path.join(ROOT, 'backend', 'static', 'qinzhou-port'),
]
/** 服务件的路径形态（先归一化成 / 再匹配，Windows 的 path.relative 是反斜杠） */
const SERVED = /(?:pinglu|qinzhou-port)\/tiles\//

const index = new Map()
const walk = (dir) => {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(glb|b3dm|json)$/i.test(e.name)) {
      if (!index.has(e.name)) index.set(e.name, [])
      index.get(e.name).push({ p: path.relative(ROOT, p), size: fs.statSync(p).size })
    }
  }
}
ROOTS.forEach(walk)

const j = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))
const out = []
for (const r of j.rows) {
  const tiles = (r.layer && r.layer.tiles) || []
  let bytes = 0
  let truncated = false
  const missing = []
  const ambiguous = []
  for (const t of tiles) {
    if (!t || t === '(无内容)') continue
    const hits = index.get(t) || []
    if (hits.length === 0) {
      missing.push(t)
      continue
    }
    const served = hits.filter((h) => SERVED.test(h.p.replace(/\\/g, '/')))
    const pick = served.length ? served : hits
    if (pick.length > 1) ambiguous.push(t)
    bytes += pick[0].size
  }
  if (tiles.length >= 12) truncated = true
  out.push({
    asset: r.asset,
    height: r.height,
    coarse: r.coarse,
    sel: r.layer ? r.layer.selected : null,
    tri: r.layer ? r.layer.tri : null,
    px: r.body ? r.body.px : null,
    mb: +(bytes / 1048576).toFixed(2),
    truncated,
    ambiguous,
    missing,
  })
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(
  'asset'.padEnd(20) +
    'h'.padStart(8) +
    '形态'.padStart(6) +
    'sel/tri'.padStart(12) +
    'px'.padStart(8) +
    'MB'.padStart(8)
)
for (const r of out) {
  console.log(
    r.asset.padEnd(20) +
      String(r.height).padStart(8) +
      (r.coarse ? '粗' : '细').padStart(6) +
      `${r.sel}/${r.tri}`.padStart(12) +
      String(r.px).padStart(8) +
      String(r.mb).padStart(8)
  )
}
const missing = out.filter((r) => r.missing.length)
const truncated = out.filter((r) => r.truncated)
const ambiguous = out.filter((r) => r.ambiguous.length)
if (truncated.length) console.log('截断行（tiles 存满 12，字节和可能少算）：', truncated.length)
if (ambiguous.length) console.log('多服务副本行：', JSON.stringify(ambiguous))
if (missing.length) {
  console.log('缺失文件：', JSON.stringify(missing))
  process.exitCode = 1
}
console.log('written', OUT)
