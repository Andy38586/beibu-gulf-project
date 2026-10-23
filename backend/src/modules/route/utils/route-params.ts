import { BusinessError, ErrorCode } from '../../../common/errors/business-error'

/**
 * 四个坐标参数的唯一解析口径（同步端点 route.controller 与异步任务域 task-handlers 共用）。
 *
 * 为什么不是各处裸 `Number(x)`：`Number(undefined)` 与 `Number('abc')` 都是 NaN，静默传给
 * 下游后表现为「查询结果为空」而不是「参数错误」——用户看到的是空地图，日志里也没有 400，
 * 无从判断是数据没有还是参数错。两处口径分叉还会让同一请求在同步/异步路径上行为不同。
 */
// 本文件私有：四个坐标逐个取值只被下面的 readRouteCoords 用，外部没有消费者。
// 留着 export 会让死物棘轮记一条「只在本文件用的导出」——那是真债，不是豁免项。
function readCoordinate(params: Record<string, unknown>, key: string): number {
  const raw = params[key]
  const value = Number(raw)
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(value)) {
    throw new BusinessError(ErrorCode.INVALID_PARAMS, `缺少或非法的参数：${key}`)
  }
  return value
}

export function readRouteCoords(params: Record<string, unknown>): {
  fromLng: number
  fromLat: number
  toLng: number
  toLat: number
} {
  return {
    fromLng: readCoordinate(params, 'fromLng'),
    fromLat: readCoordinate(params, 'fromLat'),
    toLng: readCoordinate(params, 'toLng'),
    toLat: readCoordinate(params, 'toLat'),
  }
}
