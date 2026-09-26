import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { FALLBACK_CONFIDENCE, MAX_CONFIDENCE } from '../../../common/constants/forecast.constants'
import { DtoPipe } from '../../../common/pipes/dto.pipe'
import { ForecastMapQuery, ForecastTimeseriesQuery } from '../dto/forecast.dto'
import { parseScenarioId } from '../services/scenario.service'
import { ForecastService } from '../services/forecast.service'

function parseConfidence(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return FALLBACK_CONFIDENCE
  return Math.min(n, MAX_CONFIDENCE)
}

@Controller('forecast')
/**
 * 限流：命名桶（login/register，各 50/15min）对本域是**误伤** —— 时间轴播放一轮约 400 请求，
 * 50 的配额两下见底。故与本仓其它业务域同口径：**只豁免命名桶、保留 global 桶**。
 *
 * global 是 1000/15min ⇒ 约 **2.5 轮播放**触顶，届时前端按既有 429 静默降级处理
 * （见 `useForecastLayer` 的播放分支注释）。这个边界是刻意留的：本域是**公开端点**，
 * 全豁免等于零防护，而限额又必须容得下正常交互。
 *
 * 原为裸 `@SkipThrottle()`（= 三桶全豁免）——那与 csp-report/health 的"有意全豁免"不同：
 * 那两个是被浏览器/探针高频调用的接收端，本域是用户可主动连点的计算端点。
 */
@SkipThrottle({ login: true, register: true })
@ApiTags('forecast')
export class ForecastController {
  constructor(private readonly forecastService: ForecastService) {}

  // / 与 /overview 同义：前端实际调 /overview 获取指标索引
  @Get()
  overviewRoot(): Promise<unknown> {
    return this.forecastService.readIndex()
  }

  @Get('overview')
  overview(): Promise<unknown> {
    return this.forecastService.readIndex()
  }

  @Get('map')
  getMap(@Query(new DtoPipe(ForecastMapQuery.parse)) query: ForecastMapQuery) {
    return this.forecastService.getMapData(
      query.indicator,
      query.time,
      parseConfidence(query.confidence),
      parseScenarioId(query.scenario)
    )
  }

  @Get('timeseries')
  getTimeseries(@Query(new DtoPipe(ForecastTimeseriesQuery.parse)) query: ForecastTimeseriesQuery) {
    return this.forecastService.getTimeSeriesData(
      query.indicator,
      query.portId,
      query.start,
      query.end,
      query.granularity,
      parseConfidence(query.confidence),
      parseScenarioId(query.scenario)
    )
  }

  @Get('indicator/:type')
  getIndicator(
    @Param('type') type: string,
    @Query('time') time?: string,
    @Query('portId') portId?: string,
    @Query('confidence') confidence?: string,
    @Query('scenario') scenario?: string
  ) {
    return this.forecastService.getIndicatorData(
      type,
      time,
      portId,
      parseConfidence(confidence),
      parseScenarioId(scenario)
    )
  }

  // 孤儿路由（前端零消费）保留作兼容端点；须置于显式路由之后，避免吞掉具体路径
  @Get(':portId')
  getPortForecast(
    @Param('portId') portId: string,
    @Query('indicator') indicator?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('scenario') scenario?: string
  ) {
    return this.forecastService.getPortData(
      portId,
      indicator,
      start,
      end,
      parseScenarioId(scenario)
    )
  }
}
