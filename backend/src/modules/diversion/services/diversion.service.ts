import { Injectable } from '@nestjs/common'

import {
  diversionBreakdown,
  type CanalLineResponse,
  type DiversionBreakdown,
} from '../../../common/diversion'
import { CANAL_PORT_SHARES } from '../../forecast/constants/scenario.constants'
import { DiversionRepository } from '../repositories/diversion.repository'

// 分流分析服务（论文 W10-11）：breakdown 为纯函数编排；canalLine 委托 repository
//（SQL 收口在 repository 层）。分摊份额与 F3 情景层同源（CANAL_PORT_SHARES，和=1 自校）。

/** 年份口径：插值锚点 2030~2050，域外 clamp 不外推（锚点外无文献依据） */
export const DIVERSION_YEAR_MIN = 2027
export const DIVERSION_YEAR_MAX = 2050
export const DIVERSION_YEAR_DEFAULT = 2035

export interface DiversionYearResult extends DiversionBreakdown {
  year: number
}

@Injectable()
export class DiversionService {
  constructor(private readonly repository: DiversionRepository) {}

  breakdown(year: number): DiversionYearResult {
    const clamped = Math.min(Math.max(Math.round(year), DIVERSION_YEAR_MIN), DIVERSION_YEAR_MAX)
    return { year: clamped, ...diversionBreakdown(clamped, { ...CANAL_PORT_SHARES }) }
  }

  /** 运河线位（示意线/真线位）；SQL 故障向上抛由异常层 500——线位缺失要响，不静默空图 */
  async canalLine(): Promise<CanalLineResponse> {
    return { lines: await this.repository.listCanalLines() }
  }
}
