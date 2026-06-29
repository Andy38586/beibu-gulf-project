import VectorSource from 'ol/source/Vector'
import VectorLayer from 'ol/layer/Vector'
import { fromLonLat } from 'ol/proj'
import Point from 'ol/geom/Point'
import Feature from 'ol/Feature'

export async function loadPorts() {
  const response = await fetch('/data/ports.json')
  if (!response.ok) throw new Error(`港口数据请求失败 HTTP ${response.status}`)
  const data = await response.json()
  if (!Array.isArray(data)) throw new Error('港口数据格式异常')
  return data
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
