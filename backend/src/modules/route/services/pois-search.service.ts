import { Injectable } from '@nestjs/common'

import { PoiSearchRepository, type PoiSearchRow } from '../repositories/pois-search.repository'

// POI 多源搜索服务（航线分析选点）。2026-09-30 自 site-analysis 迁入；
// 控制器不得直连 repository（cruise 分层规则），本类为薄编排层。

@Injectable()
export class PoiSearchService {
  constructor(private readonly poiSearchRepository: PoiSearchRepository) {}

  async searchPois(keyword: string, limit: number): Promise<PoiSearchRow[]> {
    return this.poiSearchRepository.searchPois(keyword, limit)
  }
}
