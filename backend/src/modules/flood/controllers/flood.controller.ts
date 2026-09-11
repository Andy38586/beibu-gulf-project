import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'

import { FloodService } from '../services/flood.service'

/**
 * 洪涝读 API。资源型端点 kebab-case 复数，操作型端点 /analysis/<action>。
 * 全部免鉴权：仅收藏需登录，disaster 评估为纯计算不读用户数据。
 * 取档/风险注入/基准偏移等编排逻辑在 FloodService。
 *
 * 限流：只计 global 桶（1000/15min）。2026-09-10 修正——原注释称"沿用全局限流桶"，
 * 但 @nestjs/throttler 的命名桶默认套用**所有**路由，仅 skip 的才豁免，于是本域
 * 实际被 login/register 桶（50/15min）卡死：一次进入浸没分析页要打 water-area、
 * flood-areas、flood-statistics、terrain-profiles 四次，15 分钟内进出约 12 次即全线 429。
 */
@SkipThrottle({ login: true, register: true })
@Controller('flood')
@ApiTags('flood')
export class FloodController {
  constructor(private readonly floodService: FloodService) {}

  /** GET /flood-areas?waterLevel=2.5 — 淹没范围数据（指定水位向上取档，未指定返回全部） */
  @Get('flood-areas')
  getFloodAreas(@Query('waterLevel') waterLevel?: string): Promise<unknown> {
    return this.floodService.getFloodAreas(waterLevel)
  }

  /** GET /flood-statistics?waterLevel=2.5 — 统计数据（向上取档；超档取最高档） */
  @Get('flood-statistics')
  getFloodStatistics(@Query('waterLevel') waterLevel?: string): Promise<unknown> {
    return this.floodService.getFloodStatistics(waterLevel)
  }

  /** GET /terrain-profiles — 剖面数据（含垂直基准偏移注入） */
  @Get('terrain-profiles')
  getTerrainProfiles(): Promise<unknown> {
    return this.floodService.getTerrainProfiles()
  }

  /** GET /water-area — 水域边界坐标数组 [[lng, lat], ...] */
  @Get('water-area')
  getWaterArea(): Promise<unknown> {
    return this.floodService.getWaterArea()
  }

  /**
   * POST /analysis/disaster — 灾害评估（免鉴权，纯计算）。
   * @HttpCode(200)：非"资源创建"端点，显式对齐 Nest POST 默认 201 之外的语义。
   */
  @Post('analysis/disaster')
  @HttpCode(200)
  analyzeDisaster(@Body() body?: { waterLevel?: unknown }): Promise<unknown> {
    return this.floodService.analyzeDisaster(body)
  }
}
