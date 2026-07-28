import { mapDataService } from '@/services/mapDataService'
import { FACILITY_COLORS } from '@/shared/constants/colors'

export async function loadPorts() {
  return await mapDataService.getPorts()
}

export function buildPortGeoJson(portsData) {
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

export const PORT_STYLE = {
  size: 12,
  color: FACILITY_COLORS[0],
  labelField: 'name',
  featureType: 'port',
}
