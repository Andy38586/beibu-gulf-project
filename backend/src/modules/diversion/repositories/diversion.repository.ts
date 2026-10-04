import { Injectable } from '@nestjs/common'

import { DbService } from '../../../infra/db/db.service'

// 运河线位数据访问（SQL 收口本层——service 层不落裸 SQL，flood.repository 同纪律）。
//
// canal 表几何以 4490（CGCS2000）存储：坐标系纪律 4490 只许存储、不许流通（04-B），
// 出库即 ST_Transform 到 4326，接口层只见裸经纬度对、无 crs 声明（84-only 流通）。
// 权威源 = 权威库 canal 表；当前 1 行示意线（9 点，止于茅尾海），
// 真线位（OSM PBF 校验后）替换表内容即全链生效——前端与契约零改动。

/** 库查询行（type 而非 interface：pg QueryResultRow 泛型约束需要隐式索引签名） */
type CanalRowDb = { name: string | null; section: string | null; geojson: string | null }

interface CanalLineRow {
  name: string | null
  section: string | null
  /** [lng, lat] 对序列（4326） */
  coordinates: Array<[number, number]>
}

@Injectable()
export class DiversionRepository {
  constructor(private readonly db: DbService) {}

  /** 运河线位各行（按 id 序，上游→下游）；表空返回 []，SQL 故障（如表缺失）向上抛由网关 500 */
  async listCanalLines(): Promise<CanalLineRow[]> {
    const res = await this.db.query<CanalRowDb>(
      `SELECT name, section, ST_AsGeoJSON(ST_Transform(geom, 4326)) AS geojson
         FROM canal
        ORDER BY id`
    )
    return res.rows
      .filter((r): r is CanalRowDb & { geojson: string } => typeof r.geojson === 'string')
      .map((r) => ({
        name: r.name ?? null,
        section: r.section ?? null,
        coordinates: (JSON.parse(r.geojson) as { coordinates: Array<[number, number]> })
          .coordinates,
      }))
  }
}
