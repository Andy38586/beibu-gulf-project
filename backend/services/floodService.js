/**
 * floodService — 洪涝灾害评估计算层（从 controller 抽出，与 forecast/site-analysis 分层对齐：
 * controller 只管参数校验与响应格式化，业务计算在此完成）
 */
import * as turf from '@turf/turf'

/**
 * 灾害评估：设施点与淹没多边形做空间筛选（与 FastAPI compute_impact 同口径），并计算损失
 * @param {Array} facilities - 设施点数组（含 lng/lat/value/damageRate）
 * @param {number} level - 请求水位（米）
 * @param {object|null} floodZone - 匹配的淹没档位（含 waterLevel/riskLevel/features）
 * @returns {{ affectedFacilities: Array, totalLoss: number, riskLevel: string, waterLevel: number|undefined }}
 */
export function assessDisaster(facilities, level, floodZone) {
  if (!floodZone || !Array.isArray(floodZone.features) || floodZone.features.length === 0) {
    // 无淹没多边形（0 档/无匹配档位）→ 无受影响设施（02 §4.3：水位 0 = 无淹没）
    return { affectedFacilities: [], totalLoss: 0, riskLevel: '无', waterLevel: undefined }
  }

  // 8-7 同源修复：设施评估基于淹没多边形空间筛选（与 online 模式连通演算同口径），
  // 替代原 elevation<=level 点高程判断——曾致 api/online 两模式判定口径分裂
  // （内陆高地按高程会误判、按连通多边形不会）。
  const polygons = floodZone.features.filter(
    (f) => f?.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
  )

  const affectedFacilities = facilities
    .filter((facility) => {
      if (!Number.isFinite(Number(facility.lng)) || !Number.isFinite(Number(facility.lat))) {
        return false
      }
      const point = turf.point([facility.lng, facility.lat])
      return polygons.some((f) => {
        try {
          return turf.booleanPointInPolygon(point, f)
        } catch {
          // 几何异常（自交/空环）按不在多边形内处理，不中断整批评估
          return false
        }
      })
    })
    .map((facility) => ({
      id: facility.id,
      name: facility.name,
      type: facility.type,
      port: facility.port,
      lng: facility.lng,
      lat: facility.lat,
      elevation: facility.elevation,
      value: facility.value,
      damageRate: facility.damageRate,
      // value/damageRate 缺失/非数值时按 0 计（显式区分：合法 0 保留，NaN/Infinity 归 0）
      loss:
        (Number.isFinite(Number(facility.value)) ? Number(facility.value) : 0) *
        (Number.isFinite(Number(facility.damageRate)) ? Number(facility.damageRate) : 0),
    }))

  const totalLoss = Math.round(affectedFacilities.reduce((sum, f) => sum + f.loss, 0))

  return {
    affectedFacilities,
    totalLoss,
    riskLevel: floodZone.riskLevel,
    waterLevel: floodZone.waterLevel,
  }
}
