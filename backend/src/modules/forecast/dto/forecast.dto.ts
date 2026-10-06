import { ApiProperty, ApiPropertyOptions } from '@nestjs/swagger'

import { missingParamError } from '../../../common/errors/business-error'
import { asRecord } from '../../../common/utils/as-record'
import { parseScenarioId } from '../services/scenario.service'

/**
 * forecast 域的查询参数 DTO。
 *
 * 本域此前是本仓**唯一**没有 dto 目录的业务域 —— 入参校验直接写在 controller 方法体里
 * （`if (!indicator || !time) throw ...`）。形态上与其它域一致的做法是：**校验收进 DTO 的
 * `static parse`，controller 只留 `@Query(new DtoPipe(XxxQuery.parse))`**，这样"参数长什么样"
 * 只有一处定义，改口径不必进 controller 找。
 *
 * ⚠️ 错误文案**逐字保持**原值（`'缺少参数: indicator, time'` 是一条、不分拆）——
 * 对外错误串是契约，统一经 `missingParamError` 生成（格式单源），收口不得顺带改文案。
 */

/** 两个查询 DTO 共用的 Swagger 字段说明（指标名/置信度阈值的对外口径，单源） */
const INDICATOR_PROP: ApiPropertyOptions = {
  description: '指标名（cargo | container | activity）',
}
const OPTIONAL_CONFIDENCE_PROP: ApiPropertyOptions = {
  required: false,
  description: '置信度阈值（可选）',
}
const OPTIONAL_SCENARIO_PROP: ApiPropertyOptions = {
  required: false,
  description: '运河情景（可选）：baseline | design | median | induced；仅 cargo 指标生效',
}

/** 查询参数兜底形态：非对象（含 null）一律落空记录；两个 parse 共用 */
function queryRecord(raw: unknown): Record<string, unknown> {
  return asRecord(raw)
}

/** GET /forecast/map 查询参数 */
export class ForecastMapQuery {
  @ApiProperty(INDICATOR_PROP)
  indicator!: string

  @ApiProperty({ description: '时间点（YYYY-MM 或 YYYY-MM-DD）' })
  time!: string

  /** 置信度阈值，可选；非法值由 service 侧 `parseConfidence` 回落默认 */
  @ApiProperty(OPTIONAL_CONFIDENCE_PROP)
  confidence?: string

  /** 运河情景，可选；解析与白名单校验收口在 `parseScenarioId`（非法值显式拒绝） */
  @ApiProperty(OPTIONAL_SCENARIO_PROP)
  scenario?: string

  static parse(raw: unknown): ForecastMapQuery {
    const q = queryRecord(raw)
    const { indicator, time, confidence, scenario } = q

    if (!indicator || !time) {
      throw missingParamError('indicator, time')
    }

    const dto = new ForecastMapQuery()
    dto.indicator = String(indicator)
    dto.time = String(time)
    dto.confidence = typeof confidence === 'string' ? confidence : undefined
    dto.scenario = parseScenarioId(scenario)
    return dto
  }
}

/** GET /forecast/timeseries 查询参数（仅 indicator 必填，其余可选） */
export class ForecastTimeseriesQuery {
  @ApiProperty(INDICATOR_PROP)
  indicator!: string

  @ApiProperty({ required: false, description: '港口 id（可选）' })
  portId?: string

  @ApiProperty({ required: false, description: '起始时间（可选）' })
  start?: string

  @ApiProperty({ required: false, description: '结束时间（可选）' })
  end?: string

  @ApiProperty({ required: false, description: '粒度（可选）' })
  granularity?: string

  @ApiProperty(OPTIONAL_CONFIDENCE_PROP)
  confidence?: string

  /** 运河情景，可选；仅 cargo 指标生效，非 cargo 组合由 service 显式拒绝 */
  @ApiProperty(OPTIONAL_SCENARIO_PROP)
  scenario?: string

  static parse(raw: unknown): ForecastTimeseriesQuery {
    const q = queryRecord(raw)
    const { indicator, portId, start, end, granularity, confidence, scenario } = q

    if (!indicator) {
      throw missingParamError('indicator')
    }

    const opt = (v: unknown) => (typeof v === 'string' ? v : undefined)
    const dto = new ForecastTimeseriesQuery()
    dto.indicator = String(indicator)
    dto.portId = opt(portId)
    dto.start = opt(start)
    dto.end = opt(end)
    dto.granularity = opt(granularity)
    dto.confidence = opt(confidence)
    dto.scenario = opt(scenario)
    return dto
  }
}
