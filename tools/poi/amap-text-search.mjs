// 高德 v3/place/text 分页抓取（fetch-amap-poi / fetch-port-poi 共用）
//
// 收敛口径（两脚本原为逐行副本）：offset 从 1 起、每页 20、累计数 ≥ count 或遇到空页即停、
// 每页之间节流 250ms（个人配额友好）、字段映射固定为 {id,name,lng,lat,district}。
// 差异只在日志前缀与「抓到之后怎么落地」，由调用方传入 label 并自行写盘/dry-run。

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 单类目抓取：返回 POI 数组；label 仅用于日志前缀（如 `port_港口`） */
export async function fetchAmapText({
  key,
  city,
  keyword,
  label,
  pageSize = 20,
  throttleMs = 250,
}) {
  const pois = []
  for (let page = 1; ; page++) {
    const url =
      'https://restapi.amap.com/v3/place/text?keywords=' +
      encodeURIComponent(keyword) +
      '&city=' +
      encodeURIComponent(city) +
      '&key=' +
      key +
      '&output=json&offset=' +
      pageSize +
      '&page=' +
      page
    const r = await fetch(url)
    const j = await r.json()
    if (j.status !== '1') {
      console.log(`[warn] ${label}: API status=${j.status} info=${j.info}`)
      break
    }
    for (const p of j.pois ?? []) {
      const [lng, lat] = (p.location || '').split(',').map(Number)
      pois.push({ id: p.id, name: p.name, lng, lat, district: p.district ?? '' })
    }
    const total = Number(j.count ?? 0)
    console.log(`[fetch] ${label} 页${page}: 累计 ${pois.length}/${total}`)
    if (pois.length >= total || (j.pois ?? []).length === 0) break
    await sleep(throttleMs)
  }
  return pois
}
