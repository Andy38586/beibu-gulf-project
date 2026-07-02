import { mapDataService } from '@/services/mapDataService'
import VectorSource from 'ol/source/Vector'
import VectorLayer from 'ol/layer/Vector'
import { fromLonLat } from 'ol/proj'
import Point from 'ol/geom/Point'
import Feature from 'ol/Feature'

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

export function buildPortLayer(portsData) {
  const portFeatures = portsData.map((port) => {
    const feature = new Feature({ geometry: new Point(fromLonLat([port.lon, port.lat])) })
    feature.setProperties(port)
    feature.set('featureType', 'port')
    return feature
  })
  return new VectorLayer({ source: new VectorSource({ features: portFeatures }) })
}

export const PORT_STYLE = {
  size: 12,
  color: '#409eff',
  labelField: 'name',
  featureType: 'port',
}
