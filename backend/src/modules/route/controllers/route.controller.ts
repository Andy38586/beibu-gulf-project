import { Controller, Get, Query } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'

import { RouteService } from '../services/route.service'

// 路径规划（route 域，公开只读免鉴权）——下沉自 algorithm-service 的 /route/path。
// 响应结构逐字段对齐 FastAPI，前端 useRouteApi 仅需切换 ENDPOINTS。
// @SkipThrottle 必需：命名桶默认套用所有路由，漏挂会被 login 桶（50/15min）误伤
//——地图高频交互 15 分钟 51 次即 429（flood 域同款事故，见 flood.controller 注释）
@SkipThrottle({ login: true, register: true })
@Controller('route')
export class RouteController {
  constructor(private readonly routeService: RouteService) {}

  /** GET /route/path?fromLng=&fromLat=&toLng=&toLat=&mode=distance|time */
  @Get('path')
  findPath(
    @Query('fromLng') fromLng: string,
    @Query('fromLat') fromLat: string,
    @Query('toLng') toLng: string,
    @Query('toLat') toLat: string,
    @Query('mode') mode?: string
  ): Promise<unknown> {
    return this.routeService.findPath({
      fromLng: Number(fromLng),
      fromLat: Number(fromLat),
      toLng: Number(toLng),
      toLat: Number(toLat),
      mode,
    })
  }
}
