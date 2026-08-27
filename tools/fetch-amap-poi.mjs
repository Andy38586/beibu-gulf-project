// 高德 POI 抓取脚本 —— 让选址 POI 数据"可二次获取"
// 用法: node --use-env-proxy tools/fetch-amap-poi.mjs [city]
// key: 读 tools/.amap_key(注意:该文件已从 git 跟踪移除,需自行保管/轮换)
// 输出: 项目数据/POI-高德重抓/{type}.json —— 与现有 qz_*.json 格式兼容 {id,name,lng,lat,district}
// 限速: 每请求 250ms(个人配额友好);分页 offset=20 直到取完
import fs from 'node:fs'
import path from 'node:path'

const city = process.argv[2] ?? '钦州'
const key = fs.readFileSync('tools/.amap_key', 'utf8').trim()
const OUT = 'C:/Users/JionHappY/Desktop/项目数据/POI-高德重抓'
fs.mkdirSync(OUT, { recursive: true })

const TYPES = [
  ['qz_hospital', '医院'],
  ['qz_primary_school', '小学'],
  ['qz_middle_school', '中学'],
  ['qz_park', '公园'],
  ['qz_bus_station', '公交站'],
  ['qz_mall_and_supermarket', '商场'],
  ['xiaoqu', '小区'],
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchType(file, keyword) {
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
      console.log(`[warn] ${file}: API status=${j.status} info=${j.info}`)
      break
    }
    for (const p of j.pois ?? []) {
      const [lng, lat] = (p.location || '').split(',').map(Number)
      pois.push({ id: p.id, name: p.name, lng, lat, district: p.district ?? '' })
    }
    const total = Number(j.count ?? 0)
    console.log(`[fetch] ${file} 页${offset}: 累计 ${pois.length}/${total}`)
    if (pois.length >= total || (j.pois ?? []).length === 0) break
    offset++
    await sleep(250)
  }
  const out = path.join(OUT, `${file}.json`)
  fs.writeFileSync(out, JSON.stringify(pois, null, 2), 'utf8')
  console.log(`[done] ${file}: ${pois.length} 条 -> ${out}`)
}

for (const [file, kw] of TYPES) {
  await fetchType(file, kw)
  await sleep(250)
}
console.log('[all done]')
