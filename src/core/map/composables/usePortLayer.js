import { mapDataService } from '@/services/mapDataService'

export async function loadPorts() {
  return await mapDataService.getPorts()
}

export function buildPortGeoJson(portsData) {
  return {
    type: 'FeatureCollection',
    features: portsData
      .filter((port) => {
        // AUDIT-016: 验证port.lon和port.lat字段存在性
        if (port.lon === undefined || port.lat === undefined) {
          if (import.meta.env.DEV) {
            console.warn('港口数据缺少坐标字段:', port)
          }
          return false
        }
        // AUDIT-016: 验证坐标有效性
        if (typeof port.lon !== 'number' || typeof port.lat !== 'number') {
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
          coordinates: [port.lon, port.lat],
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
  color: '#409eff',
  labelField: 'name',
  featureType: 'port',
}
