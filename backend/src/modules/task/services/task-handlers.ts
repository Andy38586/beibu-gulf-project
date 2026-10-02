import { Injectable } from '@nestjs/common'

import { BusinessError, ErrorCode } from '../../../common/errors/business-error'
import { FloodService } from '../../flood/services/flood.service'
import { ForecastService } from '../../forecast/services/forecast.service'
import { RouteService } from '../../route/services/route.service'
import { parseSuitabilityQuery } from '../../site-suitability/dto/site-suitability.dto'
import { SiteSuitabilityService } from '../../site-suitability/services/site-suitability.service'
import type { TaskDomain } from '../types/task'

/**
 * 任务执行器：`(params) => result`。
 *
 * 🔴 **它必须是「同步式」的纯函数形状**——排队、重试、状态推进一律由 TaskService 负责，
 * handler 里**不得**出现 setTimeout/重试/状态写入。否则重试逻辑会散落到每个域，
 * 「同一个错误被重试了 3×3 次」这类问题就再也查不清。
 */
export type TaskHandler = (params: Record<string, unknown>) => Promise<unknown>

/**
 * 域 → 业务 service 的映射表。
 *
 * 这是 task 域与业务域**唯一**的耦合点：task 域不知道洪涝怎么算、路径怎么寻，
 * 只知道「调用谁」。新增可异步化的域 = 在这里加一行 + 在 TaskDomain 加一个字面量。
 *
 * 🔴 铁律 L5（计算一律在后端）：这里委托的都是**服务端已有能力**，
 * 不允许为了「让任务看起来像在算」而在 handler 里做前端本可完成的拼装。
 */
@Injectable()
export class TaskHandlers {
  constructor(
    private readonly floodService: FloodService,
    private readonly routeService: RouteService,
    private readonly forecastService: ForecastService,
    private readonly siteSuitabilityService: SiteSuitabilityService
  ) {}

  private readonly table: Record<TaskDomain, TaskHandler> = {
    // 淹没范围：GET /flood/flood-areas?waterLevel= 的异步化
    'flood-areas': async (params) => {
      const waterLevel = params.waterLevel
      return this.floodService.getFloodAreas(
        waterLevel === undefined || waterLevel === null ? undefined : String(waterLevel)
      )
    },

    // 路径规划：GET /route/path 的异步化。参数名逐字对齐 route.controller（fromLng/fromLat/toLng/toLat）
    'route-path': async (params) => {
      const read = (key: string): number => {
        const raw = params[key]
        const value = Number(raw)
        if (!Number.isFinite(value)) {
          throw new BusinessError(ErrorCode.INVALID_PARAMS, `缺少或非法的参数：${key}`)
        }
        return value
      }
      return this.routeService.findPath({
        fromLng: read('fromLng'),
        fromLat: read('fromLat'),
        toLng: read('toLng'),
        toLat: read('toLat'),
        mode: typeof params.mode === 'string' ? params.mode : undefined,
      })
    },

    // 预测时序：GET /forecast/timeseries 的异步化。
    // 参数顺序逐字对齐 forecast.controller:55-62（indicator 为必填，其余可选）
    'forecast-timeseries': async (params) => {
      const indicator = params.indicator
      if (typeof indicator !== 'string' || indicator === '') {
        throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少或非法的参数：indicator')
      }
      const optional = (key: string): string | undefined =>
        typeof params[key] === 'string' ? (params[key] as string) : undefined
      const confidence = Number(params.confidence)
      return this.forecastService.getTimeSeriesData(
        indicator,
        optional('portId'),
        optional('start'),
        optional('end'),
        optional('granularity'),
        Number.isFinite(confidence) && confidence > 0 ? confidence : 1.0
      )
    },

    // 预测热力图：GET /forecast/map 的异步化（v4-S3 补入）。
    // 参数逐字对齐 forecast.controller:34-45（indicator/time 必填，confidence 可选）
    'forecast-map': async (params) => {
      const indicator = params.indicator
      const time = params.time
      if (typeof indicator !== 'string' || indicator === '') {
        throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少或非法的参数：indicator')
      }
      if (typeof time !== 'string' || time === '') {
        throw new BusinessError(ErrorCode.INVALID_PARAMS, '缺少或非法的参数：time')
      }
      const confidence = Number(params.confidence)
      return this.forecastService.getMapData(
        indicator,
        time,
        Number.isFinite(confidence) && confidence > 0 ? confidence : 1.0
      )
    },

    // 选址热力图：GET /site-suitability/map 的异步化（方案 A「慢请求自动提议转后台」，2026-10-02）。
    // 参数逐字对齐 site-suitability.controller（w_* / min_land_frac / resolution 同名透传）；
    // 解析与校验复用 parseSuitabilityQuery —— 不在这里再抄一份权重白名单（禁忌 7）。
    'site-suitability-map': async (params) =>
      this.siteSuitabilityService.compute(parseSuitabilityQuery(params)),
  }

  /** 取执行器；未知域显式报错（而不是静默返回 undefined ⇒ 队列空转） */
  get(domain: TaskDomain): TaskHandler {
    const handler = this.table[domain]
    if (!handler) {
      throw new BusinessError(ErrorCode.INVALID_PARAMS, `不支持的任务域：${domain}`)
    }
    return handler
  }

  /** 支持的域列表——controller 用它做白名单校验，避免领域白名单写两处 */
  get supportedDomains(): TaskDomain[] {
    return Object.keys(this.table) as TaskDomain[]
  }
}
