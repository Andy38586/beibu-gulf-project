import { Controller, Get, Query } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'

import { SKIP_AUTH_NAMED_THROTTLERS } from '../../../common/constants/throttling.constants'
import { PoiSearchService } from '../services/pois-search.service'
import { RouteService } from '../services/route.service'
import { readRouteCoords } from '../utils/route-params'

// 路径规划（route 域，公开只读免鉴权）——下沉自 algorithm-service 的 /route/path。
// 响应结构逐字段对齐 FastAPI，前端 useRouteApi 仅需切换 ENDPOINTS。
// @SkipThrottle 必需：命名桶默认套用所有路由，漏挂会被 login 桶（50/15min）误伤
//——地图高频交互 15 分钟 51 次即 429（flood 域同款事故，见 flood.controller 注释）
@SkipThrottle(SKIP_AUTH_NAMED_THROTTLERS)
@Controller('route')
export class RouteController {
  constructor(
    private readonly routeService: RouteService,
    private readonly poiSearchService: PoiSearchService
  ) {}

  /**
   * GET /route/pois?keyword=&limit= —— 航线分析选点的多源 POI 搜索。
   * 2026-09-30 自旧版选址域迁入（唯一消费者是本域前端；老选址已在本次移除，见
   * docs/archive/老选址隔离与移除工单-2026-09-30.md）。keyword 空返回兜底列表；
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
  findPath(@Query() query: Record<string, string | undefined>): Promise<unknown> {
    // 坐标解析与异步任务域共用同一口径（route/utils/route-params）：
    // 非法参数一律 400，不把 NaN 静默传给下游
    return this.routeService.findPath({ ...readRouteCoords(query), mode: query.mode })
  }
}
