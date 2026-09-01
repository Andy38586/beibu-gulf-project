import type { Feature, FeatureCollection, Geometry } from 'geojson'

import type { BusinessLayerManager } from '@/core'
import { FACILITY_COLORS, LAYER_FILL_COVERAGE } from '@/shared'
import { logger } from '@/shared'
import type { AnalysisResult, FacilityPoint, LayerOptions, ScoredXiaoqu } from '@/types'

import { FACILITY_CONFIG } from './facilityConfig'

/** 附近设施合并图层 id（BLM registry / mapStore catalog / 渲染器 featureType 三处同源；业务前缀防跨模块 key 冲突，a066） */
export const NEARBY_FACILITY_LAYER_ID = 'site-nearby-facility'
/** 分析覆盖范围图层 id（与 featureType 同值，三处同源） */
export const ANALYSIS_COVERAGE_LAYER_ID = 'site-analysis-coverage'
/** 匹配小区图层 id（与 featureType 同值，三处同源） */
export const ANALYSIS_MATCHED_LAYER_ID = 'site-analysis-matched'

/** createUpdateHandler 实际使用的 manager 方法子集（与 BLM 解耦，页面传入的 manager 无需完整 BLM 类型） */
type AnalysisLayerManager = Pick<BusinessLayerManager, 'register' | 'updateData' | 'has'>

export function buildCoverageGeoJson(
  coverage: Feature<Geometry> | FeatureCollection<Geometry> | null
): FeatureCollection<Geometry> {
  if (!coverage) {
    return { type: 'FeatureCollection', features: [] }
  }
  let geojson: FeatureCollection<Geometry>
  if (coverage.type === 'FeatureCollection') {
    geojson = { ...coverage }
    geojson.features = coverage.features.map((f) => ({
      ...f,
      properties: { ...f.properties, featureType: ANALYSIS_COVERAGE_LAYER_ID },
    }))
  } else {
    geojson = {
      type: 'FeatureCollection',
      features: [
        {
          ...coverage,
          properties: { ...coverage.properties, featureType: ANALYSIS_COVERAGE_LAYER_ID },
        },
      ],
    }
  }
  return geojson
}

export function buildMatchedGeoJson(matchedXiaoqu: ScoredXiaoqu[]): FeatureCollection<Geometry> {
  return {
    type: 'FeatureCollection',
    features: matchedXiaoqu
      .filter((xq: ScoredXiaoqu) => {
        // 运行时防御：类型层 lng/lat 为 number，但后端数据可能缺失/非法，需逐条校验
        const lng = xq.lng as number | undefined
        const lat = xq.lat as number | undefined
        if (lng === undefined || lat === undefined) {
          logger.debug('小区数据缺少坐标字段:', xq)
          return false
        }
        if (typeof lng !== 'number' || typeof lat !== 'number') {
          logger.debug('小区坐标字段类型无效:', xq)
          return false
        }
        if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
          logger.debug('小区坐标值超出有效范围:', xq)
          return false
        }
        return true
      })
      .map((xq: ScoredXiaoqu) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [xq.lng, xq.lat],
        },
        properties: {
          ...xq,
          featureType: ANALYSIS_MATCHED_LAYER_ID,
        },
      })),
  }
}

export const COVERAGE_STYLE: LayerOptions = {
  fillColor: LAYER_FILL_COVERAGE,
  strokeColor: FACILITY_COLORS[0],
  strokeWidth: 1,
  featureType: ANALYSIS_COVERAGE_LAYER_ID,
}

export const MATCHED_STYLE: LayerOptions = {
  size: 6,
  color: FACILITY_COLORS[2],
  featureType: ANALYSIS_MATCHED_LAYER_ID,
}

/** 分析图层描述符（getAnalysisLayers 返回的条目形状） */
interface AnalysisLayerDescriptor {
  id: string
  label: string
  geojson: FeatureCollection<Geometry>
  style: LayerOptions
}

/** 设施 POI 图层描述符（points adapter，数据携带 per-point opacity/color） */
export interface FacilityPoiLayerDescriptor {
  id: string
  label: string
  layerType: 'points'
  data: {
    id?: string
    lng: number
    lat: number
    name: string
    poiType: string
    color: string
    opacity: number
  }[]
  options: LayerOptions
}

/** 「层层筛选」透明度口径：未激活点低透明 + 暗化打底（渲染器对 alpha<1 同步拉低亮度），
 *  激活（小区在设施覆盖半径内）实体 100% 并恢复原色亮度——层层筛选的视觉根基。
 *  0.3 为视觉裁决值：卫星底图上「淡但可见」；嫌抢眼/嫌隐身改这一个常量即可 */
const POI_BASE_OPACITY = 0.3
const POI_HIT_OPACITY = 1

/** haversine 距离（km）：小区→设施归属判断。量级小（≤数千次/次点击），无需引 turf */
export function haversineKm(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const R = 6371
  const rad = Math.PI / 180
  const dLat = (bLat - aLat) * rad
  const dLng = (bLng - aLng) * rad
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * 附近设施合并图层（单层承载 6 类 POI）：图层控制面板一个「附近设施」开关管总显隐，
 * 雷达轴名管呼吸、结果列表管命中透明度——三类控制各占一个入口互不耦合。
 * 数据点带 per-point color（FACILITY_COLORS_MAP 同源）与 opacity（基准 50%，命中 100%），
 * 不传 labelField——名字不常显，改走要素气泡（MapFacilityBubble，点击显示）。
 * hitByType 为 null 时全部点基准透明度；否则命中点实体化。
 */
export function buildFacilityPoiLayer(
  facilityPoi: Record<string, FacilityPoint[]>,
  selectedTypes: string[],
  hitByType: Record<string, Set<string>> | null
): FacilityPoiLayerDescriptor {
  const data: FacilityPoiLayerDescriptor['data'] = []
  for (const type of selectedTypes) {
    const pois = facilityPoi[type]
    if (!Array.isArray(pois) || pois.length === 0) continue
    const config = FACILITY_CONFIG[type as keyof typeof FACILITY_CONFIG]
    const label = config?.label ?? type
    const color = config?.color ?? FACILITY_COLORS[0]
    const hits = hitByType?.[type]
    for (const p of pois) {
      data.push({
        id: p.id,
        lng: p.lng,
        lat: p.lat,
        name: p.name || label,
        poiType: type,
        color,
        opacity: hits && p.id && hits.has(p.id) ? POI_HIT_OPACITY : POI_BASE_OPACITY,
      })
    }
  }
  return {
    id: NEARBY_FACILITY_LAYER_ID,
    label: '附近设施',
    layerType: 'points',
    data,
    options: {
      size: 8,
      color: FACILITY_COLORS[0],
      featureType: NEARBY_FACILITY_LAYER_ID,
      // 不聚合：全量点常显（未激活低透明+暗化）是层层筛选的视觉根基；
      // 千级点走 OL 视口裁剪（>1000 阈值自动启用）保流畅，视觉效果不变
    },
  }
}

/**
 * importanceToRadius 前端复刻（backend/services/scoringService.js:40 同口径）：
 * 实际覆盖半径 = defaultRadius × importance 档位系数（1:0.4/2:0.7/3:1.0/4:1.5/5:2.2），
 * 四舍五入到 0.1km。命中判断必须走此函数，否则与后端 buffer 口径漂移。
 */
const IMPORTANCE_FACTOR: Record<number, number> = { 1: 0.4, 2: 0.7, 3: 1.0, 4: 1.5, 5: 2.2 }
export function effectiveRadiusKm(type: string, importance: number): number {
  const base = FACILITY_CONFIG[type as keyof typeof FACILITY_CONFIG]?.defaultRadius ?? 1
  const factor = IMPORTANCE_FACTOR[Math.round(importance)] ?? 1
  return Math.round(base * factor * 10) / 10
}

/**
 * 计算参与选址的设施 id 并集（层层筛选渲染集合）：
 * 被「任一匹配小区」覆盖半径内的设施才算参与——没参与的小区选址的点不上图
 * （渲染集合从全量千级收缩到数百级，性能与视觉聚焦双赢）。
 * 半径经 effectiveRadiusKm 换算（importance 档位），与后端 buffer 同口径。
 */
export function computeParticipatingPoiIds(
  matchedXiaoqu: Pick<ScoredXiaoqu, 'lng' | 'lat'>[],
  pois: FacilityPoint[],
  radiusKm: number
): Set<string> {
  const ids = new Set<string>()
  for (const xq of matchedXiaoqu) {
    if (typeof xq.lng !== 'number' || typeof xq.lat !== 'number') continue
    for (const p of pois) {
      if (typeof p.lng !== 'number' || typeof p.lat !== 'number') continue
      if (p.id && haversineKm(xq.lng, xq.lat, p.lng, p.lat) <= radiusKm) {
        ids.add(p.id)
      }
    }
  }
  return ids
}

/**
 * 计算小区周边（各类型覆盖半径内）的设施 id 集合。
 * 半径经 effectiveRadiusKm 换算（importance 档位），与后端 buffer 同口径。
 */
export function computeHitPoiIds(
  xq: Pick<ScoredXiaoqu, 'lng' | 'lat'>,
  pois: FacilityPoint[],
  radiusKm: number
): Set<string> {
  const hits = new Set<string>()
  for (const p of pois) {
    if (typeof p.lng !== 'number' || typeof p.lat !== 'number') continue
    if (p.id && haversineKm(xq.lng, xq.lat, p.lng, p.lat) <= radiusKm) {
      hits.add(p.id)
    }
  }
  return hits
}

/** useAnalysisLayer 返回值 */
interface UseAnalysisLayerReturn {
  getAnalysisLayers: (result: Partial<AnalysisResult>) => AnalysisLayerDescriptor[]
  createUpdateHandler: (
    businessLayerManager: AnalysisLayerManager
  ) => (result: Partial<AnalysisResult>) => Promise<void>
}

/** 创建分析结果处理函数：经 BLM 管理图层生命周期，不直接调用 renderer */
export function useAnalysisLayer(): UseAnalysisLayerReturn {
  let isUpdating = false
  let pendingResult: Partial<AnalysisResult> | null = null

  function getAnalysisLayers(result: Partial<AnalysisResult>): AnalysisLayerDescriptor[] {
    const layers: AnalysisLayerDescriptor[] = []

    if (result.coverage) {
      layers.push({
        id: ANALYSIS_COVERAGE_LAYER_ID,
        label: '分析覆盖范围',
        geojson: buildCoverageGeoJson(result.coverage),
        style: COVERAGE_STYLE,
      })
    }

    if (result.matchedXiaoqu?.length) {
      layers.push({
        id: ANALYSIS_MATCHED_LAYER_ID,
        label: '匹配小区',
        geojson: buildMatchedGeoJson(result.matchedXiaoqu ?? []),
        style: MATCHED_STYLE,
      })
    }

    return layers
  }

  function createUpdateHandler(
    businessLayerManager: AnalysisLayerManager
  ): (result: Partial<AnalysisResult>) => Promise<void> {
    return async function setAnalysisResult(result: Partial<AnalysisResult>): Promise<void> {
      if (isUpdating) {
        pendingResult = result
        return
      }
      isUpdating = true
      try {
        const layers = getAnalysisLayers(result)
        for (const layer of layers) {
          if (!businessLayerManager.has(layer.id)) {
            businessLayerManager.register(layer.id, {
              label: layer.label,
              layerType: 'geojson',
              data: layer.geojson,
              options: layer.style,
              visible: true,
            })
          } else {
            businessLayerManager.updateData(layer.id, {
              data: layer.geojson,
              options: layer.style,
            })
          }
        }
      } catch (e) {
        // 816-专项2 7-3：调用点为 `void updateAnalysisHandler(result)` 无 catch——
        // 同步 throw（BLM 数据守卫）在此消化，防浮动 rejection（异步 rejection 已被 BLM 内部消化）
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console -- DEV 门控诊断（logger.warn 无 DEV 门控，语义不同）
          console.warn('[useAnalysisLayer] 图层更新失败:', e)
        }
      } finally {
        isUpdating = false
        if (pendingResult) {
          const next = pendingResult
          pendingResult = null
          await setAnalysisResult(next)
        }
      }
    }
  }

  return { getAnalysisLayers, createUpdateHandler }
}
