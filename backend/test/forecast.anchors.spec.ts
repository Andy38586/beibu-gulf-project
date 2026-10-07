import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 热力锚点一致性守门（2026-09-11 新增）
 *
 * 背景：港口坐标曾是「三轨并存」——
 *   - frontend/public/data/ports.json（权威源，真港口坐标）
 *   - activity.json（已对齐权威源）
 *   - cargo.json / container.json / index.json（早期 mock 市区坐标，钦州北偏约 25km）
 * 同一个港口三套坐标，且在用的 cargo/container 热力点落在市区而非港口。
 * 本测试把「所有消费中的锚点必须等于权威源」固化为断言，防止将来又被复制歪。
 *
 * 注意：berth / traffic 前端已下架，其合成数据文件已于 2026-10-07 删除；
 * 下方保留一条「文件不得回流」断言，防止 mock 坐标被再度当回真值复制。
 */

const ROOT = path.resolve(__dirname, '../..')

/** 权威源：frontend/public/data/ports.json（端口 id 与 forecast 文件的 data key 对齐） */
const PORT_ID_BY_NAME: Record<string, string> = {
  钦州港口岸: 'qinzhou',
  北海国际客运港: 'beihai',
  防城港: 'fangchenggang',
}

function readJson(rel: string): any {
  return JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'))
}

/** 权威坐标表：{ qinzhou: {lng, lat}, ... } */
function authoritativeAnchors(): Record<string, { lng: number; lat: number }> {
  const ports = readJson('frontend/public/data/ports.json') as Array<{
    name: string
    lng: number
    lat: number
  }>
  const out: Record<string, { lng: number; lat: number }> = {}
  for (const p of ports) {
    const id = PORT_ID_BY_NAME[p.name]
    if (!id) continue
    out[id] = { lng: p.lng, lat: p.lat }
  }
  return out
}

describe('热力锚点一致性（防三轨回归）', () => {
  const anchors = authoritativeAnchors()

  it('权威源解析出 3 个港口（qinzhou / beihai / fangchenggang）', () => {
    expect(Object.keys(anchors).sort()).toEqual(['beihai', 'fangchenggang', 'qinzhou'])
  })

  // 消费中的三个指标文件都必须与权威源逐字一致
  it.each(['cargo', 'container', 'activity'])(
    '%s.json 的空间锚点等于 ports.json 权威坐标',
    (indicator) => {
      const data = readJson(`backend/data/forecast/${indicator}.json`)
      for (const [id, want] of Object.entries(anchors)) {
        const coords = data.data[id]?.spatial?.features?.[0]?.geometry?.coordinates
        expect(coords, `${indicator}.json 缺少 ${id} 的锚点`).toBeDefined()
        expect(coords, `${indicator}.json 的 ${id} 锚点偏离权威源`).toEqual([want.lng, want.lat])
      }
    }
  )

  it('index.json 的 metadata.ports 等于权威坐标（它是坐标的原始来源，必须同源）', () => {
    const idx = readJson('backend/data/forecast/index.json')
    const byId: Record<string, { lng: number; lat: number }> = {}
    for (const p of idx.metadata.ports) byId[p.id] = { lng: p.lng, lat: p.lat }
    for (const [id, want] of Object.entries(anchors)) {
      expect(byId[id], `index.json 缺少港口 ${id}`).toBeDefined()
      expect(byId[id].lng, `index.json 的 ${id} lng 偏离权威源`).toBeCloseTo(want.lng, 6)
      expect(byId[id].lat, `index.json 的 ${id} lat 偏离权威源`).toBeCloseTo(want.lat, 6)
    }
  })

  it('已下架的 berth / traffic 数据文件已删除（mock 坐标不得回流）', () => {
    // 阳性对照：同目录在用指标存在 ⇒ 本判据不是「路径写错恒不命中」
    expect(existsSync(path.join(ROOT, 'backend/data/forecast/cargo.json'))).toBe(true)
    for (const name of ['berth', 'traffic']) {
      expect(
        existsSync(path.join(ROOT, `backend/data/forecast/${name}.json`)),
        `${name}.json 重新出现：若确要启用，先对齐权威锚点并在 anchor-check 与用例中同步登记`
      ).toBe(false)
    }
  })

  it('消费中的指标不得再出现早期 mock 市区坐标（108.62,21.95 等）', () => {
    const MOCK_ANCHORS = [
      [108.62, 21.95],
      [109.12, 21.48],
      [108.35, 21.77],
    ]
    for (const indicator of ['cargo', 'container', 'activity']) {
      const data = readJson(`backend/data/forecast/${indicator}.json`)
      for (const [id, coords] of Object.entries<any>(data.data)) {
        const c = coords?.spatial?.features?.[0]?.geometry?.coordinates
        for (const mock of MOCK_ANCHORS) {
          expect(c, `${indicator}.json 的 ${id} 仍是 mock 市区坐标`).not.toEqual(mock)
        }
      }
    }
  })
})
