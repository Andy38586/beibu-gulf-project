#!/usr/bin/env node
// fetch-port-poi.mjs — 高德港口码头 POI 补抓（T4.3 产物）
// 复用 fetch-amap-poi 的抓取模式（同一份 amap-text-search.mjs）：三城（钦州/北海/防城港）×
// 三类目（港口/码头/泊位），分页拉到完，输出 {city}_{type}.json 到 $BEIBU_POI_DIR
//（缺省 tools/.poi_cache），与既有 POI 格式兼容 {id,name,lng,lat,district}。去重入库由 import 环节处理。
//
// 用法:
//   node tools/gis-import/fetch-port-poi.mjs              # 全量抓取三城三类型
//   node tools/gis-import/fetch-port-poi.mjs --dry-run    # 只试连通性，每城一类采样（不写文件）
import fs from 'node:fs'
import path from 'node:path'

import { fetchAmapText, sleep } from '../poi/amap-text-search.mjs'

const key = fs.readFileSync('tools/.amap_key', 'utf8').trim()
const dryRun = process.argv.includes('--dry-run')
// 输出目录：BEIBU_POI_DIR 优先；缺省落 gitignored 的 tools/.poi_cache（与 import-port-poi.mjs 同源）
const OUT = process.env.BEIBU_POI_DIR ?? path.join(import.meta.dirname, '..', '.poi_cache')
fs.mkdirSync(OUT, { recursive: true })

// 港口类目：type=port_pier 落 poi_facilities（T4.3 拍板：入库既有 poi 表，同构复用渲染与验证）
const CITIES = ['钦州', '北海', '防城港']
const TYPES = [
  ['port', '港口'],
  ['pier', '码头'],
  ['berth', '泊位'],
]

for (const city of CITIES) {
  for (const [file, kw] of TYPES) {
    const label = `${city}_${file}`
    const pois = await fetchAmapText({ key, city, keyword: kw, label })
    if (dryRun) {
      console.log(`[dry-run] ${label}: ${pois.length} 条命中（不落盘）`)
    } else {
      const out = path.join(OUT, `${label}.json`)
      fs.writeFileSync(out, JSON.stringify(pois, null, 2), 'utf8')
      console.log(`[done] ${file}: ${pois.length} 条 -> ${out}`)
    }
    await sleep(250)
  }
}
console.log('[all done]')
