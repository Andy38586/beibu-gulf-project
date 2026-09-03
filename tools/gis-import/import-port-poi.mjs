#!/usr/bin/env node
// import-port-poi.mjs — 导入已抓取的高德港口码头泊位 POI 到 poi_facilities
// 用法: node tools/gis-import/import-port-poi.mjs > .tmp-pip/import-port-poi.sql
// 然后: docker exec -i beibu-postgis psql -U postgres -d v3_dev < .tmp-pip/import-port-poi.sql
//
// 输入（已由 fetch-port-poi.mjs 抓取到桌面）:
//   C:/Users/JionHappY/Desktop/_北部湾项目/数据_/项目数据/POI-高德重抓/{城市}_{port/pier/berth}.json
// 输出:
//   SQL 语句，每条 INSERT 带 id/type/name/district/city/geom(Point 4490)
//   去重：同一 id 只保留第一个（高德 POI id 全局唯一，跨城市不冲突）

import fs from 'node:fs'
import path from 'node:path'

const srcDir = 'C:/Users/JionHappY/Desktop/_北部湾项目/数据_/项目数据/POI-高德重抓'
const cityMap = {
  钦州: 'qz',
  北海: 'bh',
  防城港: 'fcg',
}

const esc = (v) => (v == null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`)
const pt = (lng, lat) => `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4490)`

const seen = new Set()
let totalIn = 0
let totalOut = 0
let totalDup = 0
let totalBad = 0

console.log('-- 导入港口码头泊位 POI 到 poi_facilities (type=port_pier)')
console.log('BEGIN;\n')

for (const [cnCity, qzCity] of Object.entries(cityMap)) {
  for (const type of ['port', 'pier', 'berth']) {
    const file = path.join(srcDir, `${cnCity}_${type}.json`)
    if (!fs.existsSync(file)) {
      console.log(`-- skip ${file} (not found)`)
      continue
    }
    const list = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(list) || list.length === 0) {
      console.log(`-- skip ${cnCity}_${type} (empty)`)
      continue
    }
    totalIn += list.length
    for (const item of list) {
      if (!item.id || !Number.isFinite(item.lng) || !Number.isFinite(item.lat)) {
        totalBad++
        continue
      }
      if (seen.has(item.id)) {
        totalDup++
        continue
      }
      seen.add(item.id)
      // 幂等追加：与库内既有 id 冲突（如旧 bus_station 撞 id）时跳过保留原记录
      const sql =
        `INSERT INTO poi_facilities (id, type, name, district, city, geom) VALUES (` +
        `${esc(item.id)}, 'port_pier', ${esc(item.name)}, ${esc(item.district)}, '${qzCity}', ${pt(item.lng, item.lat)}) ON CONFLICT (id) DO NOTHING;`
      console.log(sql)
      totalOut++
    }
  }
}

console.log(`\nCOMMIT;`)

console.error(`
统计:
  输入: ${totalIn} 条
  去重: ${totalDup} 条 (已跳过)
  坏数据(缺坐标/id): ${totalBad} 条 (已跳过)
  输出: ${totalOut} 条 → 写入 poi_facilities
`)
