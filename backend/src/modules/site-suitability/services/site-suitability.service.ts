import { Injectable } from '@nestjs/common'

import { SiteSuitabilityRepository } from '../repositories/site-suitability.repository'
import { parseWeights, type CellScore, type FactorCell, type SuitabilityWeights } from './scoring'
import type { SuitabilityQuery } from '../dto/site-suitability.dto'

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
    weightsSource: 'query' | 'ahp-final'
    kdeP99: number
    minLandFrac: number
  }
}

@Injectable()
export class SiteSuitabilityService {
  constructor(private readonly repository: SiteSuitabilityRepository) {}

  async compute(query: SuitabilityQuery): Promise<SuitabilityResult> {
    const weights: SuitabilityWeights = parseWeights(query.weights)
    const [rows, kdeP99] = await Promise.all([
      this.repository.fetchCells(query.minLandFrac),
      this.repository.fetchKdeP99(),
    ])

    const features = rows.map((row) => {
      const cell: FactorCell = {
        id: row.id,
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
        weightsSource: 'ahp-final',
        kdeP99,
        minLandFrac: query.minLandFrac,
      },
    }
  }
}
