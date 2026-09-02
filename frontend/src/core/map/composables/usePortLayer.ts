import type { FeatureCollection } from 'geojson'

import { mapDataService } from '@/services'
import { buildPointFeatureCollection, FACILITY_COLORS } from '@/shared'
import { logger } from '@/shared'
import type { LayerOptions, Port } from '@/types'

export async function loadPorts(signal?: AbortSignal): Promise<Port[]> {
  return await mapDataService.getPorts(signal)
}

export function buildPortGeoJson(portsData: Port[]): FeatureCollection {
  return buildPointFeatureCollection(portsData, {
    coordOf: (port) => {
      if (port.lng === undefined || port.lat === undefined) {
        logger.debug('港口数据缺少坐标字段:', port)
        return null
      }
      if (typeof port.lng !== 'number' || typeof port.lat !== 'number') {
        logger.debug('港口坐标字段类型无效:', port)
        return null
      }
      return { lng: port.lng, lat: port.lat }
    },
    propsOf: (port) => ({ ...port, featureType: 'port' }),
  })
}

export const PORT_STYLE: LayerOptions = {
  size: 12,
  color: FACILITY_COLORS[0],
  labelField: 'name',
  featureType: 'port',
}
