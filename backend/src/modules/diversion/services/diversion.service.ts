import { Injectable } from '@nestjs/common'

import { diversionBreakdown, type DiversionBreakdown } from '../../../common/diversion'
import { CANAL_PORT_SHARES } from '../../forecast/constants/scenario.constants'

// 分流分析服务（论文 W10-11）：纯函数编排，无 DB。
// 分摊份额与 F3 情景层同源（CANAL_PORT_SHARES，和=1 由 diversionBreakdown 自校）。

/** 年份口径：插值锚点 2030~2050，域外 clamp 不外推（锚点外无文献依据） */
export const DIVERSION_YEAR_MIN = 2027
export const DIVERSION_YEAR_MAX = 2050
export const DIVERSION_YEAR_DEFAULT = 2035

export interface DiversionYearResult extends DiversionBreakdown {
  year: number
}

@Injectable()
export class DiversionService {
  breakdown(year: number): DiversionYearResult {
    const clamped = Math.min(Math.max(Math.round(year), DIVERSION_YEAR_MIN), DIVERSION_YEAR_MAX)
    return { year: clamped, ...diversionBreakdown(clamped, { ...CANAL_PORT_SHARES }) }
  }
}
