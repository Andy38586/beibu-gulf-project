// 高德 POI 抓取脚本 —— 让选址 POI 数据"可二次获取"
// 用法: node --use-env-proxy tools/poi/fetch-amap-poi.mjs [city]
// key: 读 tools/.amap_key(注意:该文件已从 git 跟踪移除,需自行保管/轮换)
// 输出: $BEIBU_POI_DIR 或 tools/.poi_cache/{type}.json —— 与现有 qz_*.json 格式兼容
// 限速: 每请求 250ms(个人配额友好);分页/收敛/节流见 amap-text-search.mjs（与 port-poi 同源）
import fs from 'node:fs'
import path from 'node:path'

import { fetchAmapText, sleep } from './amap-text-search.mjs'

const city = process.argv[2] ?? '钦州'
const key = fs.readFileSync('tools/.amap_key', 'utf8').trim()
// 输出目录：BEIBU_POI_DIR 优先；缺省落 gitignored 的 tools/.poi_cache（外置数据树不随仓库分发）
const OUT = process.env.BEIBU_POI_DIR ?? path.join(import.meta.dirname, '..', '.poi_cache')
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

for (const [file, kw] of TYPES) {
  const pois = await fetchAmapText({ key, city, keyword: kw, label: file })
  const out = path.join(OUT, `${file}.json`)
  fs.writeFileSync(out, JSON.stringify(pois, null, 2), 'utf8')
  console.log(`[done] ${file}: ${pois.length} 条 -> ${out}`)
  await sleep(250)
}
console.log('[all done]')
