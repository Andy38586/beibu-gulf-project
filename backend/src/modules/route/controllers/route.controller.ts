import { Controller, Get, Query } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'

import { PoiSearchService } from '../services/pois-search.service'
import { RouteService } from '../services/route.service'

// 路径规划（route 域，公开只读免鉴权）——下沉自 algorithm-service 的 /route/path。
// 响应结构逐字段对齐 FastAPI，前端 useRouteApi 仅需切换 ENDPOINTS。
// @SkipThrottle 必需：命名桶默认套用所有路由，漏挂会被 login 桶（50/15min）误伤
//——地图高频交互 15 分钟 51 次即 429（flood 域同款事故，见 flood.controller 注释）
@SkipThrottle({ login: true, register: true })
@Controller('route')
export class RouteController {
  constructor(
    private readonly routeService: RouteService,
    private readonly poiSearchService: PoiSearchService
  ) {}

  /**
   * GET /route/pois?keyword=&limit= —— 航线分析选点的多源 POI 搜索。
   * 2026-09-30 自旧版选址域迁入（唯一消费者是本域前端；老选址已在本次移除，见
   * docs/老选址隔离与移除工单-2026-09-30.md）。keyword 空返回兜底列表；
   * limit 钳制 1..200（与原实现一致）。
   */
  @Get('pois')
  async searchPois(
    @Query('keyword') keyword?: string,
    @Query('limit') limit?: string
  ): Promise<unknown> {
    const parsed = Number(limit)
    return this.poiSearchService.searchPois(keyword ?? '', Number.isFinite(parsed) ? parsed : 50)
  }

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
