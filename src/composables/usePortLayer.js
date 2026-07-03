import { mapDataService } from '@/services/mapDataService'

export async function loadPorts() {
  return await mapDataService.getPorts()
}

export function buildPortGeoJson(portsData) {
  return {
    type: 'FeatureCollection',
    features: portsData.map((port) => ({
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
