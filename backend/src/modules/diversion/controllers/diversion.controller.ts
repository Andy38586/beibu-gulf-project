import { Controller, Get, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import {
  DIVERSION_YEAR_DEFAULT,
  DIVERSION_YEAR_MAX,
  DIVERSION_YEAR_MIN,
  DiversionService,
} from '../services/diversion.service'

/**
 * 分流分析（论文 W10-11）：GET /diversion/breakdown?year=2035。
 * 免鉴权纯计算（同 forecast/site-suitability 口径：公开端点只豁免命名桶）。
 * 出参 = 西江转移量（分货类）+ 三港分摊 + 桑基图节点流（sankeyFlows）。
 */
@SkipThrottle({ login: true, register: true })
@Controller('diversion')
@ApiTags('diversion')
export class DiversionController {
  constructor(private readonly service: DiversionService) {}

  @Get('breakdown')
  breakdown(@Query('year') year?: string): unknown {
    const raw = year === undefined || year === '' ? DIVERSION_YEAR_DEFAULT : Number(year)
    if (!Number.isFinite(raw)) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, `year 非数值: ${String(year)}`)
    }
    if (raw < DIVERSION_YEAR_MIN || raw > DIVERSION_YEAR_MAX) {
      throw new BusinessError(
        ErrorCode.INVALID_PARAMS,
        `year 须 ∈ [${DIVERSION_YEAR_MIN}, ${DIVERSION_YEAR_MAX}]`
      )
    }
    return this.service.breakdown(raw)
  }
}
