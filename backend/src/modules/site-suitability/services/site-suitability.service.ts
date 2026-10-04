import { Injectable } from '@nestjs/common'

import { SiteSuitabilityRepository } from '../repositories/site-suitability.repository'
import { parseWeights, type CellScore, type FactorCell, type SuitabilityWeights } from './scoring'
import {
  DEFAULT_MIN_LAND_FRAC,
  DEFAULT_RESOLUTION,
  defaultWeights,
  type SuitabilityQuery,
} from '../dto/site-suitability.dto'
import { DEFAULT_THRESHOLDS, type ScoreThresholds } from '../constants/score.constants'

import { cellScore } from './scoring'

// 加权叠加编排（单元四）：库行 → 纯函数评分 → GeoJSON FeatureCollection。
// 计算全在内存（148k 行算术），出参形状为契约 siteSuitabilityResponseSchema（前端
// types/schemas.ts，@backend-contract 反向核对指向本文件）。

export interface SuitabilityResult {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: { id: number; score: number } & Partial<CellScore['sub']>
  }>
  metadata: {
    count: number
    weights: SuitabilityWeights
    weightsSource: 'query' | 'ahp-default'
    kdeP99: number
    minLandFrac: number
    /** 实际使用的聚合分辨率（度）；0 = 全分辨率 */
    resolution: number
  }
}

/** GET /defaults 出参（前端 siteSuitabilityDefaultsSchema 逐字段反向核对） */
export interface SuitabilityDefaults {
  weights: Record<string, number>
  thresholds: ScoreThresholds
  minLandFrac: number
  resolution: number
  source: string
}

@Injectable()
export class SiteSuitabilityService {
  constructor(private readonly repository: SiteSuitabilityRepository) {}

  async compute(query: SuitabilityQuery): Promise<SuitabilityResult> {
    const weights: SuitabilityWeights = parseWeights(query.weights)
    const [rows, kdeP99] = await Promise.all([
      this.repository.fetchCellsAt(query.minLandFrac, query.resolution),
      this.repository.fetchKdeP99(),
    ])

    const features = rows.map((row) => {
      const cell: FactorCell = {
        // 契约归一：库列 bigint（pg 驱动给字符串）→ 出参 schema 声明 number。
        // id 现值量级 ≤ 1.5e5（远小于 2^53），Number() 无精度风险。
        id: Number(row.id),
        meanElevM: row.mean_elev_m,
        meanSlopeDeg: row.mean_slope_deg,
        landFrac: row.land_frac,
        landClass: row.land_class,
        distPortM: row.dist_port_m,
        distRoadM: row.dist_road_m,
        kdeMass: row.kde_mass,
      }
      const cs: CellScore = cellScore(cell, weights, kdeP99)
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [row.lon, row.lat] as [number, number] },
        properties: { id: cs.id, score: cs.score, ...cs.sub },
      }
    })

    return {
      type: 'FeatureCollection',
      features,
      metadata: {
        count: features.length,
        weights,
        weightsSource: query.weightsSource,
        kdeP99,
        minLandFrac: query.minLandFrac,
        // 回显实际聚合口径：0 = 全分辨率；前端可据此提示"当前为聚合视图"
        resolution: query.resolution,
      },
    }
  }

  /**
   * 默认值单源（GET /site-suitability/defaults）：权重定稿向量 + 阈值表 +
   * 过滤/分辨率缺省。前端 store 以此为准；拉不到时用同值快照兜底（快照见
   * frontend/src/business/site-suitability/constants/defaults.snapshot.ts，
   * 成功/兜底在日志可区分，UI 无区别）。
   */
  getDefaults(): SuitabilityDefaults {
    return {
      weights: defaultWeights(),
      thresholds: DEFAULT_THRESHOLDS,
      minLandFrac: DEFAULT_MIN_LAND_FRAC,
      resolution: DEFAULT_RESOLUTION,
      source: 'SITE_AHP_MATRIX@2026-09-30',
    }
  }
}
