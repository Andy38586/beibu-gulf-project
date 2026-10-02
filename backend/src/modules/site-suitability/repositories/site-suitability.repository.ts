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
    return this.fetchCellsAt(minLandFrac, 0)
  }

  /**
   * 取格网行；resolution > 0 时按粗格聚合（性能治本，2026-10-02）。
   *
   * 为什么要聚合：全量 14 万格 GeoJSON ≈ 28.8MB（实测 content-length），浏览器 JSON.parse
   * + 建对象 + 热力图渲染直接卡死。热力图看的是密度/分值分布，粗格均值与其视觉等价。
   * 聚合口径（不臆造）：坐标取格内质心；连续量（高程/坡度/陆地占比/距离/KDE）取 AVG；
   * **类目量 land_class 取众数**（AVG 会把类别号平均成无意义的数）。
   */
  async fetchCellsAt(minLandFrac: number, resolution: number): Promise<SuitabilityCellRow[]> {
    if (!(resolution > 0)) {
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
    const r = await this.db.query<SuitabilityCellRow>(
      `SELECT min(id) AS id,
              ST_X(ST_Centroid(ST_Collect(geom))) AS lon,
              ST_Y(ST_Centroid(ST_Collect(geom))) AS lat,
              avg(mean_elev_m) AS mean_elev_m,
              avg(mean_slope_deg) AS mean_slope_deg,
              avg(land_frac) AS land_frac,
              mode() WITHIN GROUP (ORDER BY land_class) AS land_class,
              avg(dist_port_m) AS dist_port_m,
              avg(dist_road_m) AS dist_road_m,
              avg(kde_mass) AS kde_mass
         FROM suitability_cells
        WHERE land_frac >= $1
        GROUP BY floor(ST_X(geom) / $2), floor(ST_Y(geom) / $2)`,
      [minLandFrac, resolution]
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
