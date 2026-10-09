import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { SKIP_AUTH_NAMED_THROTTLERS } from '../../../common/constants/throttling.constants'
import { parseSuitabilityQuery } from '../dto/site-suitability.dto'
import {
  SiteSuitabilityService,
  type SuitabilityDefaults,
} from '../services/site-suitability.service'

/**
 * 新选址适宜性加权叠加（工单 §四单元四）。GET /nest-api/site-suitability/map，
 * 免鉴权纯计算（同 forecast 口径：公开端点，只豁免命名桶防误伤）。
 * 入参 = 五准则权重（w_*，缺省回落 AHP 定稿特征向量 SITE_AHP_MATRIX）+ min_land_frac 过滤；
 * 出参 = 格网 GeoJSON（siteSuitabilityResponseSchema 契约）。
 */
@SkipThrottle(SKIP_AUTH_NAMED_THROTTLERS)
@Controller('site-suitability')
@ApiTags('site-suitability')
export class SiteSuitabilityController {
  constructor(private readonly service: SiteSuitabilityService) {}

  @Get('map')
  async map(@Query() query: Record<string, unknown>): Promise<unknown> {
    return this.service.compute(parseSuitabilityQuery(query))
  }

  /**
   * 默认值单源（前端 store 以此为准，快照兜底见 stores/siteSuitabilityDefaults.snapshot.ts）。
   * 本 controller 无参数路由，静态路径无冲突。
   */
  @Get('defaults')
  async defaults(): Promise<SuitabilityDefaults> {
    return this.service.getDefaults()
  }
}
