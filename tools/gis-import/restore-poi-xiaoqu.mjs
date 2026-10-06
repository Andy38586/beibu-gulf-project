#!/usr/bin/env node
// restore-poi-xiaoqu.mjs — 从桌面快照恢复 poi_facilities + xiaoqu（2026-09-29）
//
// 背景：库内 JSON 派生表（users/plans/favorites/poi_facilities/xiaoqu）被清空，
// 而 GIS 表完好——疑为 backend/data 的 site-selection/ 等目录移往桌面后 db-import
// 被重跑：TRUNCATE 无条件执行、readOptional 静默读空 ⇒ 清库且未灌回（待立案）。
// 本脚本只做恢复语义：INSERT ... ON CONFLICT DO NOTHING，**无 TRUNCATE**，
// 不触碰 users/plans 等其他表。
//
// 源（09-05 完整快照，命名与 db-import POI_TYPES 对齐）:
//   $BEIBU_POI_SNAPSHOT 或 .local/data/poi-snapshot/{city}_{type}.json
// 用法:
//   node tools/gis-import/restore-poi-xiaoqu.mjs > .local/tmp/restore-poi-xiaoqu.sql
//   docker exec -i beibu-postgis psql -U postgres -d beibu-gulf-data -v ON_ERROR_STOP=1 \
//     < .local/tmp/restore-poi-xiaoqu.sql
import fs from 'node:fs'
import path from 'node:path'

// 快照目录：BEIBU_POI_SNAPSHOT 优先；缺省 .local/data/poi-snapshot（外置快照不随仓库分发）
const SRC =
  process.env.BEIBU_POI_SNAPSHOT ??
  path.join(import.meta.dirname, '..', '..', '.local', 'data', 'poi-snapshot')
const CITIES = [
  ['qz', 'qz'],
  ['bh', 'bh'],
  ['fcg', 'fcg'],
]
const POI_TYPES = [
  'hospital',
  'primary_school',
  'middle_school',
  'park',
  'bus_station',
  'mall',
  'port_pier',
]
// 北部湾业务边界（与 db-import GULF_BOUNDS 同值副本，导入期坐标守卫）
const GULF = { minLng: 105, maxLng: 115, minLat: 18, maxLat: 25 }

const esc = (v) => (v == null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`)
const pt = (lng, lat) => `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4490)`

const lines = ['\\set ON_ERROR_STOP on']
const report = []
let totalWritten = 0
let totalBad = 0

function readCityFile(city, kind) {
  const file = path.join(SRC, `${city}_${kind}.json`)
  if (!fs.existsSync(file)) {
    report.push(`  ${city}_${kind}: 文件缺失（跳过）`)
    return
  }
  const items = JSON.parse(fs.readFileSync(file, 'utf8'))
  let written = 0
  let bad = 0
  for (const it of items) {
    const { id, name, lng, lat, district } = it
    if (!id || !Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat))) {
      bad++
      continue
    }
    const lo = Number(lng)
    const la = Number(lat)
    if (lo < GULF.minLng || lo > GULF.maxLng || la < GULF.minLat || la > GULF.maxLat) {
      bad++
      continue
    }
    if (kind === 'xiaoqu') {
      lines.push(
        `INSERT INTO xiaoqu (id, name, district, city, geom) VALUES (${esc(id)}, ${esc(name)}, ${esc(district)}, '${city}', ${pt(lo, la)}) ON CONFLICT (id) DO NOTHING;`
      )
    } else {
      lines.push(
        `INSERT INTO poi_facilities (id, type, name, district, city, geom) VALUES (${esc(id)}, '${kind}', ${esc(name)}, ${esc(district)}, '${city}', ${pt(lo, la)}) ON CONFLICT (id) DO NOTHING;`
      )
    }
    written++
  }
  report.push(`  ${city}_${kind}: 读 ${items.length} 写 ${written} 跳(缺坐标/越界) ${bad}`)
  totalWritten += written
  totalBad += bad
}

for (const [city] of CITIES) {
  for (const kind of POI_TYPES) readCityFile(city, kind)
  readCityFile(city, 'xiaoqu')
}

lines.push(
  `INSERT INTO import_meta (version, note) VALUES ('poi-restore-20260929', 'poi_facilities+xiaoqu 从桌面 09-05 快照恢复（只增不清；users/plans 丢失另案处理）') ON CONFLICT (version) DO NOTHING;`
)
lines.push('')

console.error(`恢复汇总：写 ${totalWritten} 条，跳 ${totalBad} 条`)
for (const r of report) console.error(r)
console.log(lines.join('\n'))
