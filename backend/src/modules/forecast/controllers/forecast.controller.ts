import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { DEFAULT_CONFIDENCE, MAX_CONFIDENCE } from '../../../common/constants/forecast.constants'
import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import { ForecastService } from '../services/forecast.service'

function parseConfidence(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CONFIDENCE
  return Math.min(n, MAX_CONFIDENCE)
}

// 预测接口为合法高频交互（时间轴播放一轮 ~400+ 请求）：跳过全部限流桶，
// 对齐 Express 全局限流 skip /api/forecast + 专属 forecastLimiter（同为 1000/15min）
@Controller('forecast')
@SkipThrottle()
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
  getMap(
    @Query('indicator') indicator: string,
    @Query('time') time: string,
    @Query('confidence') confidence?: string
  ) {
    if (!indicator || !time) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少参数: indicator, time')
    }
    return this.forecastService.getMapData(indicator, time, parseConfidence(confidence))
  }

  @Get('timeseries')
  getTimeseries(
    @Query('indicator') indicator: string,
    @Query('portId') portId?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('granularity') granularity?: string,
    @Query('confidence') confidence?: string
  ) {
    return this.forecastService.getTimeSeriesData(
      indicator,
      portId,
      start,
      end,
      granularity,
      parseConfidence(confidence)
    )
  }

  @Get('indicator/:type')
  getIndicator(
    @Param('type') type: string,
    @Query('time') time?: string,
    @Query('portId') portId?: string,
    @Query('confidence') confidence?: string
  ) {
    return this.forecastService.getIndicatorData(type, time, portId, parseConfidence(confidence))
  }

  // 孤儿路由（前端零消费）保留作兼容端点；须置于显式路由之后，避免吞掉具体路径
  @Get(':portId')
  getPortForecast(
    @Param('portId') portId: string,
    @Query('indicator') indicator?: string,
    @Query('start') start?: string,
    @Query('end') end?: string
  ) {
    return this.forecastService.getPortData(portId, indicator, start, end)
  }
}
