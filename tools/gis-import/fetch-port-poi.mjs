#!/usr/bin/env node
// fetch-port-poi.mjs — 高德港口码头 POI 补抓（T4.3 产物）
// 复用 fetch-amap-poi.mjs 的抓取模式：三城（钦州/北海/防城港）× 三类目（港口/码头/泊位），
// 分页拉到完，输出 {city}_{type}.json 到项目数据目录，与既有 POI 格式兼容
// {id,name,lng,lat,district}。去重入库由 import 环节处理。
//
// 用法:
//   node tools/gis-import/fetch-port-poi.mjs              # 全量抓取三城三类型
//   node tools/gis-import/fetch-port-poi.mjs --dry-run    # 只试连通性，每城一类采样（不写文件）
import fs from 'node:fs'
import path from 'node:path'

const key = fs.readFileSync('tools/.amap_key', 'utf8').trim()
const dryRun = process.argv.includes('--dry-run')
const OUT = 'C:/Users/JionHappY/Desktop/_北部湾项目/数据_/项目数据/POI-高德重抓'
fs.mkdirSync(OUT, { recursive: true })

// 港口类目：type=port_pier 落 poi_facilities（T4.3 拍板：入库既有 poi 表，同构复用渲染与验证）
const CITIES = ['钦州', '北海', '防城港']
const TYPES = [
  ['port', '港口'],
  ['pier', '码头'],
  ['berth', '泊位'],
]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchType(city, file, keyword) {
  const pois = []
  let offset = 1
  const PAGE = 20
  for (;;) {
    const url =
      'https://restapi.amap.com/v3/place/text?keywords=' +
      encodeURIComponent(keyword) +
      '&city=' +
      encodeURIComponent(city) +
      '&key=' +
      key +
      '&output=json&offset=' +
      PAGE +
      '&page=' +
      offset
    const r = await fetch(url)
    const j = await r.json()
    if (j.status !== '1') {
      console.log(`[warn] ${city}_${file}: API status=${j.status} info=${j.info}`)
      break
    }
    for (const p of j.pois ?? []) {
      const [lng, lat] = (p.location || '').split(',').map(Number)
      pois.push({ id: p.id, name: p.name, lng, lat, district: p.district ?? '' })
    }
    const total = Number(j.count ?? 0)
    console.log(`[fetch] ${city}_${file} 页${offset}: 累计 ${pois.length}/${total}`)
    if (pois.length >= total || (j.pois ?? []).length === 0) break
    offset++
    await sleep(250)
  }
  if (dryRun) {
    console.log(`[dry-run] ${city}_${file}: ${pois.length} 条命中（不落盘）`)
    return
  }
  const out = path.join(OUT, `${city}_${file}.json`)
  fs.writeFileSync(out, JSON.stringify(pois, null, 2), 'utf8')
  console.log(`[done] ${file}: ${pois.length} 条 -> ${out}`)
}

for (const city of CITIES) {
  for (const [file, kw] of TYPES) {
    await fetchType(city, file, kw)
    await sleep(250)
  }
}
console.log('[all done]')
