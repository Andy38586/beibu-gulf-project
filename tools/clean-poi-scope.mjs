/**
 * 选址 POI 市区口径清洗（2026-08-30，一次性）
 *
 * 背景：三城 POI 按区县全境抓取（交接文档①口径），把「真属辖区但远离市区」的
 * 离岛/深山镇点也抓了进来，后果：
 *   1. 涠洲岛（属北海海城区）78 个点画在海上 —— 用户报告的「北海 POI 被污染」；
 *   2. 三城 CITY_SCOPES bbox（useCityScope.ts，取自数据外接矩形）被撑大失真：
 *      bh 南界 21.0133（涠洲岛）、fcg 西界 107.5017（峒中）、qz 东界 109.05（那思），
 *      造成 qz/fcg bbox 大面积重叠（108.22-108.57）。
 *
 * 清洗口径（市区连续片，保留近郊镇、删离岛与深山镇）：
 *   bh: district==='海城区' && lat<21.35  → 涠洲岛/斜阳岛（冠头岭 21.43，安全余量 0.08°）
 *   fcg: lng<108.0                        → 峒中/那良/扶隆/板八深山镇（江山/华石/滩营近郊保留）
 *   qz: lat>22.25 || lng>108.95           → 板城/长滩深山 + 那思镇（大寺/小董/那丽近郊保留）
 *
 * 清洗后必须同步重算 useCityScope.ts 的 CITY_SCOPES bbox（本脚本末尾打印）。
 * 备份：tools/.poi_cache/_backup_pre_clean_20260830/
 */
import fs from 'node:fs'
import path from 'node:path'

const DIR = 'backend/data/site-selection'

const RULES = {
  bh: (p) => p.district === '海城区' && p.lat < 21.35,
  fcg: (p) => p.lng < 108.0,
  qz: (p) => p.lat > 22.25 || p.lng > 108.95,
}

const bboxes = { qz: null, bh: null, fcg: null }

for (const f of fs.readdirSync(DIR).filter((f) => /^(?:qz|bh|fcg)_\w+\.json$/.test(f))) {
  const city = f.slice(0, f.indexOf('_'))
  const rule = RULES[city]
  if (!rule) continue
  const file = path.join(DIR, f)
  const arr = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Array.isArray(arr)) continue
  const kept = arr.filter((p) => !rule(p))
  const removed = arr.length - kept.length
  if (removed > 0) {
    const samples = arr
      .filter(rule)
      .slice(0, 3)
      .map((p) => p.name)
    fs.writeFileSync(file, JSON.stringify(kept, null, 2) + '\n')
    console.log(`${f}: ${arr.length} -> ${kept.length} (删 ${removed}) 例: ${samples.join(' / ')}`)
  } else {
    console.log(`${f}: 无需清洗 (${arr.length})`)
  }
  // 清洗后 bbox
  for (const p of kept) {
    const b = (bboxes[city] ??= { minLng: 999, minLat: 999, maxLng: -999, maxLat: -999 })
    b.minLng = Math.min(b.minLng, p.lng)
    b.maxLng = Math.max(b.maxLng, p.lng)
    b.minLat = Math.min(b.minLat, p.lat)
    b.maxLat = Math.max(b.maxLat, p.lat)
  }
}

console.log('\n=== 清洗后 bbox（写回 useCityScope.ts CITY_SCOPES）===')
for (const [city, b] of Object.entries(bboxes)) {
  const r = (v) => v.toFixed(4)
  console.log(`${city}: [${r(b.minLng)}, ${r(b.minLat)}, ${r(b.maxLng)}, ${r(b.maxLat)}]`)
}
