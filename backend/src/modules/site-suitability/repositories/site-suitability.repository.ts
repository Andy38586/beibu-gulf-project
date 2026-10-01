import { Injectable } from '@nestjs/common'

import { DbService } from '../../../infra/db/db.service'

// 选址统一因子格网取数（SQL 收口本层；表与列见 tools/db/db-schema-gis.sql
// suitability_cells 段与 tools/site-suitability/materialize-cells.sql）。

export interface SuitabilityCellRow {
  /**
   * ⚠️ 这里必须是 string：suitability_cells.id 是 bigint，node-postgres 为避免精度
   * 丢失**按字符串返回** int8。对外契约（⑯ siteSuitabilityResponseSchema）声明
   * properties.id 为 number ⇒ 由 service 在 API 边界做 Number() 归一
   * （2026-10-01 生产事故：漏了这步 ⇒ zod 边界校验失败 ⇒ 面板永远"暂无数据"，
   * 而 HTTP 200 把故障藏住了）。
   */
  id: string
  lon: number
  lat: number
  mean_elev_m: number
  mean_slope_deg: number
  land_frac: number
  land_class: number | null
  dist_port_m: number
  dist_road_m: number
  kde_mass: number | null
}

@Injectable()
export class SiteSuitabilityRepository {
  constructor(private readonly db: DbService) {}

  /** 全量格网行（land_frac 下限过滤由 SQL 做，降低传输量）；KDE 99 分位同程取回 */
  async fetchCells(minLandFrac: number): Promise<SuitabilityCellRow[]> {
    const r = await this.db.query<SuitabilityCellRow>(
      `SELECT id,
              ST_X(geom) AS lon, ST_Y(geom) AS lat,
              mean_elev_m, mean_slope_deg, land_frac,
              land_class, dist_port_m, dist_road_m, kde_mass
         FROM suitability_cells
        WHERE land_frac >= $1`,
      [minLandFrac]
    )
    return r.rows
  }

  /** KDE 质量全局 99 分位（demand 归一化分母；NULL 不计） */
  async fetchKdeP99(): Promise<number> {
    const r = await this.db.query<{ p99: number | null }>(
      `SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY kde_mass)::double precision AS p99
         FROM suitability_cells WHERE kde_mass IS NOT NULL`
    )
    return r.rows[0]?.p99 ?? 0
  }
}
