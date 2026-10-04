import type { FeatureCollection, LineString } from 'geojson'

import { useOwnedLayers } from '@/core'
import { LAYER_KEYS, PORT_PORTS, diversionArcLayerId } from '@/shared'
import type { LayerOptions } from '@/types'

import {
  ARC_COLOR,
  ARC_COLOR_HIGHLIGHT,
  CANAL_LINE_COLOR,
  CANAL_LINE_HIGHLIGHT,
  CANAL_LINE_WIDTH,
  arcWidthFor,
  buildPortArc,
} from '../constants/diversionMap'

/** 运河线位图层 id（LAYER_KEYS 权威表登记；裸字面量会被 layer-keys 守卫拦） */
export const DIVERSION_CANAL_LAYER_ID = LAYER_KEYS.diversionCanal

/** 一条弧线的上图要素（portId ∈ PORT_PORTS 键集；value 为该港当年分流总量，万吨/年） */
export interface DiversionArcSpec {
  portId: string
  portName: string
  /** 运河线位末点 [lng,lat]（示意线 = 茅尾海口） */
  start: [number, number]
  /** 港口端点 [lng,lat] */
  end: [number, number]
  value: number
}

/** 运河线位 GeoJSON（canal-line 响应每行一条 LineString，一一对应） */
function buildCanalGeoJson(lines: Array<Array<[number, number]>>): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: lines.map((coordinates) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: { featureType: DIVERSION_CANAL_LAYER_ID },
    })),
  }
}

/** 单条分流弧 GeoJSON（几何见 diversionMap 头注释；样式经 options，值随 properties 供调试/气泡） */
function buildArcGeoJson(spec: DiversionArcSpec): FeatureCollection<LineString> {
  const coordinates = buildPortArc(
    { lng: spec.start[0], lat: spec.start[1] },
    { lng: spec.end[0], lat: spec.end[1] }
  )
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: {
          featureType: diversionArcLayerId(spec.portId),
          port: spec.portName,
          value: spec.value,
        },
      },
    ],
  }
}

interface UseDiversionLayerReturn {
  /** 运河线位上图（幂等；空段集清理图层；highlighted=桑基「平陆运河」节点联动高亮色） */
  updateCanalLayer: (lines: Array<Array<[number, number]>>, highlighted?: boolean) => void
  /**
   * 三港弧线上图（幂等）：宽度按三弧最大值相对编码（arcWidthFor）；
   * highlightPortId 高亮单弧（桑基联动 A3），缺省无高亮全常规色。
   */
  updateArcLayers: (specs: DiversionArcSpec[], highlightPortId?: string | null) => void
  /** 主动清（卸载清由 useOwnedLayers 作用域负责，与 useRouteLayer 同语义） */
  clearDiversionLayers: () => void
}

/**
 * 图层注册一律经 useOwnedLayers（结构约束，useRouteLayer/useForecastLayer 同纪律）：
 * 弧线/运河线均 engines:['cesium']——本页已切 3D（manifest），2D 渲染器下 reapplyAll
 * 跳过创建，不会在 2D 上画弧。
 */
export function useDiversionLayer(): UseDiversionLayerReturn {
  const owned = useOwnedLayers('diversion')

  function updateCanalLayer(lines: Array<Array<[number, number]>>, highlighted = false): void {
    if (lines.length > 0) {
      owned.applyOrUpdate(DIVERSION_CANAL_LAYER_ID, {
        label: '运河线位',
        layerType: 'geojson',
        data: buildCanalGeoJson(lines),
        options: {
          strokeColor: highlighted ? CANAL_LINE_HIGHLIGHT : CANAL_LINE_COLOR,
          strokeWidth: CANAL_LINE_WIDTH,
          featureType: DIVERSION_CANAL_LAYER_ID,
        } as LayerOptions,
        engines: ['cesium'],
        visible: true,
      })
    } else {
      owned.unregister(DIVERSION_CANAL_LAYER_ID)
    }
  }

  function updateArcLayers(specs: DiversionArcSpec[], highlightPortId: string | null = null): void {
    const max = Math.max(0, ...specs.map((s) => s.value))
    for (const spec of specs) {
      const key = diversionArcLayerId(spec.portId)
      const highlighted = spec.portId === highlightPortId
      owned.applyOrUpdate(key, {
        label: `分流→${spec.portName}`,
        layerType: 'geojson',
        data: buildArcGeoJson(spec),
        options: {
          strokeColor: highlighted ? ARC_COLOR_HIGHLIGHT : ARC_COLOR,
          strokeWidth: arcWidthFor(spec.value, max),
          featureType: key,
        } as LayerOptions,
        engines: ['cesium'],
        visible: true,
      })
    }
  }

  function clearDiversionLayers(): void {
    owned.unregister(DIVERSION_CANAL_LAYER_ID)
    // 注册集合封闭于 PORT_PORTS 键集——新增港口自动纳入清程，无需手抄清单
    for (const { key } of PORT_PORTS) {
      owned.unregister(diversionArcLayerId(key))
    }
  }

  return { updateCanalLayer, updateArcLayers, clearDiversionLayers }
}
