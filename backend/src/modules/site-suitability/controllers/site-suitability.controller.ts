import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { parseSuitabilityQuery } from '../dto/site-suitability.dto'
import { SiteSuitabilityService } from '../services/site-suitability.service'

/**
 * 新选址适宜性加权叠加（工单 §四单元四）。GET /nest-api/site-suitability/map，
 * 免鉴权纯计算（同 site-analysis/forecast 口径：公开端点，只豁免命名桶防误伤）。
 * 入参 = 五准则权重（w_*，缺省回落 AHP 草案特征向量）+ min_land_frac 过滤；
 * 出参 = 格网 GeoJSON（siteSuitabilityResponseSchema 契约）。
 */
@SkipThrottle({ login: true, register: true })
@Controller('site-suitability')
@ApiTags('site-suitability')
export class SiteSuitabilityController {
  constructor(private readonly service: SiteSuitabilityService) {}

  @Get('map')
  async map(@Query() query: Record<string, unknown>): Promise<unknown> {
    return this.service.compute(parseSuitabilityQuery(query))
  }
}
