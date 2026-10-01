// @vitest-environment node
// 契约回归：properties.id 必须是 number。
//
// 2026-10-01 生产事故（真实形态）：suitability_cells.id 是 bigint，node-postgres 按
// 字符串返回（\"id\":\"4\"），而对外契约 ⑯ siteSuitabilityResponseSchema 声明
// properties.id: z.number() ⇒ HTTP 边界 zod 校验失败 ⇒ 前端请求管线抛错、数据不进
// store ⇒ 页面永远显示"暂无数据/格数 0"，且因为 HTTP 200 而没有任何显式报错。
//
// 本用例在 service 边界钉死类型，不依赖真库（CI 与本地都能跑）：
// 假仓储返回 pg 的真实形态（字符串 id），断言出参已归一为 number。
import { describe, expect, it } from 'vitest'

import type { SiteSuitabilityRepository } from '../src/modules/site-suitability/repositories/site-suitability.repository'
import { SiteSuitabilityService } from '../src/modules/site-suitability/services/site-suitability.service'

/** 假仓储：只实现本用例用到的两个方法；行形状照抄 pg 的真实返回（id 为字符串） */
function repoWith(row: Record<string, unknown>): SiteSuitabilityRepository {
  return {
    fetchCells: async () => [row],
    fetchKdeP99: async () => 1,
  } as unknown as SiteSuitabilityRepository
}

const PG_ROW = {
  id: '4', // ← 关键：pg 对 bigint 的真实形态
  lon: 107.3083350133,
  lat: 22.6088032632,
  mean_elev_m: 12.5,
  mean_slope_deg: 1.2,
  land_frac: 0.8,
  land_class: 10,
  dist_port_m: 1500,
  dist_road_m: 220,
  kde_mass: 0.5,
}

describe('site-suitability 对外契约：id 类型归一', () => {
  it('properties.id 是 number（pg 的 bigint 字符串在 service 边界被归一）', async () => {
    const svc = new SiteSuitabilityService(repoWith(PG_ROW))
    const res = await svc.compute({
      weights: { inundation: 0.4, terrain: 0.1, land: 0.2, access: 0.2, demand: 0.1 },
      minLandFrac: 0.5,
    })

    expect(res.features).toHaveLength(1)
    const props = res.features[0].properties
    expect(typeof props.id).toBe('number')
    expect(props.id).toBe(4)
    // 出参其余字段也须是 JSON number（防止同类透传再犯）
    expect(typeof props.score).toBe('number')
    expect(typeof res.metadata.count).toBe('number')
    expect(typeof res.metadata.kdeP99).toBe('number')
  })

  it('JSON 往返后 id 仍是 number（序列化层不把它变回字符串）', async () => {
    const svc = new SiteSuitabilityService(repoWith(PG_ROW))
    const res = await svc.compute({
      weights: { inundation: 0.4, terrain: 0.1, land: 0.2, access: 0.2, demand: 0.1 },
      minLandFrac: 0.5,
    })
    const roundTrip = JSON.parse(JSON.stringify(res))
    expect(typeof roundTrip.features[0].properties.id).toBe('number')
  })
})
