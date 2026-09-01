import { Injectable } from '@nestjs/common'
import * as turf from '@turf/turf'

// 洪涝灾害评估计算层（逐行等价移植 backend/services/floodService.js）：
// 设施点与淹没多边形空间筛选（与 FastAPI compute_impact 同口径），损失 = value × damageRate
export interface FloodFacility {
  id: string
  name: string
  type: string
  port: string
  lng: number
  lat: number
  elevation: number
  value: number
  damageRate: number
}

export interface FloodZoneFeature {
  geometry?: { type?: string } | null
  properties?: Record<string, unknown>
}

export interface FloodZone {
  waterLevel: number
  riskLevel: string
  features?: FloodZoneFeature[]
}

export interface DisasterAssessment {
  affectedFacilities: Array<Record<string, unknown>>
  totalLoss: number
  riskLevel: string
  waterLevel: number | undefined
}

@Injectable()
export class FloodService {
  assessDisaster(
    facilities: FloodFacility[],
    level: number,
    floodZone: FloodZone | null
  ): DisasterAssessment {
    if (!floodZone || !Array.isArray(floodZone.features) || floodZone.features.length === 0) {
      // 无淹没多边形（0 档/无匹配档位）→ 无受影响设施（02 §4.3：水位 0 = 无淹没）；
      // 风险等级统一「无风险」（与前端 colors.ts 键一致）
      return { affectedFacilities: [], totalLoss: 0, riskLevel: '无风险', waterLevel: undefined }
    }

    // 设施评估基于淹没多边形空间筛选（与 online 模式连通演算同口径），
    // 替代点高程判断——内陆高地按高程会误判、按连通多边形不会
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
            return turf.booleanPointInPolygon(point, f as never)
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
        // value/damageRate 缺失/非数值时按 0 计（合法 0 保留，NaN/Infinity 归 0）
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
}
