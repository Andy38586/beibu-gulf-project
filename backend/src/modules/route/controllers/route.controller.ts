import { Controller, Get, Query } from '@nestjs/common'

import { RouteService } from '../services/route.service'

// 路径规划（route 域，公开只读免鉴权）——下沉自 algorithm-service 的 /route/path。
// 响应结构逐字段对齐 FastAPI，前端 useRouteApi 仅需切换 ENDPOINTS。
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
