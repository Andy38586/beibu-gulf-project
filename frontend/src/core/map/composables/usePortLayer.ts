import type { FeatureCollection } from 'geojson'

import { mapDataService } from '@/services/mapDataService'
import { FACILITY_COLORS } from '@/shared/constants/colors'
import type { LayerOptions, Port } from '@/types'

export async function loadPorts(): Promise<Port[]> {
  return await mapDataService.getPorts()
}

export function buildPortGeoJson(portsData: Port[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: portsData
      .filter((port) => {
        // 验证port.lng和port.lat字段存在性
        if (port.lng === undefined || port.lat === undefined) {
          if (import.meta.env.DEV) {
            console.warn('港口数据缺少坐标字段:', port)
          }
          return false
        }
        // 验证坐标有效性
        if (typeof port.lng !== 'number' || typeof port.lat !== 'number') {
          if (import.meta.env.DEV) {
            console.warn('港口坐标字段类型无效:', port)
          }
          return false
        }
        return true
      })
      .map((port) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [port.lng, port.lat],
        },
        properties: {
          ...port,
          featureType: 'port',
        },
      })),
  }
}

export const PORT_STYLE: LayerOptions = {
  size: 12,
  color: FACILITY_COLORS[0],
  labelField: 'name',
  featureType: 'port',
}
