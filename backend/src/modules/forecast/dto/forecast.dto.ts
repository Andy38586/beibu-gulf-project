import { ApiProperty } from '@nestjs/swagger'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'

/**
 * forecast 域的查询参数 DTO。
 *
 * 本域此前是本仓**唯一**没有 dto 目录的业务域 —— 入参校验直接写在 controller 方法体里
 * （`if (!indicator || !time) throw ...`）。形态上与其它域一致的做法是：**校验收进 DTO 的
 * `static parse`，controller 只留 `@Query(new DtoPipe(XxxQuery.parse))`**，这样"参数长什么样"
 * 只有一处定义，改口径不必进 controller 找。
 *
 * ⚠️ 错误文案**逐字保持**原值（`'缺少参数: indicator, time'` 是一条、不分拆）——
 * 对外错误串是契约，收口不得顺带改文案。
 */

/** GET /forecast/map 查询参数 */
export class ForecastMapQuery {
  @ApiProperty({ description: '指标名（cargo | container | activity）' })
  indicator!: string

  @ApiProperty({ description: '时间点（YYYY-MM 或 YYYY-MM-DD）' })
  time!: string

  /** 置信度阈值，可选；非法值由 service 侧 `parseConfidence` 回落默认 */
  @ApiProperty({ required: false, description: '置信度阈值（可选）' })
  confidence?: string

  static parse(raw: unknown): ForecastMapQuery {
    const q = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const { indicator, time, confidence } = q

    if (!indicator || !time) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少参数: indicator, time')
    }

    const dto = new ForecastMapQuery()
    dto.indicator = String(indicator)
    dto.time = String(time)
    dto.confidence = typeof confidence === 'string' ? confidence : undefined
    return dto
  }
}

/** GET /forecast/timeseries 查询参数（仅 indicator 必填，其余可选） */
export class ForecastTimeseriesQuery {
  @ApiProperty({ description: '指标名（cargo | container | activity）' })
  indicator!: string

  @ApiProperty({ required: false, description: '港口 id（可选）' })
  portId?: string

  @ApiProperty({ required: false, description: '起始时间（可选）' })
  start?: string

  @ApiProperty({ required: false, description: '结束时间（可选）' })
  end?: string

  @ApiProperty({ required: false, description: '粒度（可选）' })
  granularity?: string

  @ApiProperty({ required: false, description: '置信度阈值（可选）' })
  confidence?: string

  static parse(raw: unknown): ForecastTimeseriesQuery {
    const q = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const { indicator, portId, start, end, granularity, confidence } = q

    if (!indicator) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少参数: indicator')
    }

    const opt = (v: unknown) => (typeof v === 'string' ? v : undefined)
    const dto = new ForecastTimeseriesQuery()
    dto.indicator = String(indicator)
    dto.portId = opt(portId)
    dto.start = opt(start)
    dto.end = opt(end)
    dto.granularity = opt(granularity)
    dto.confidence = opt(confidence)
    return dto
  }
}
