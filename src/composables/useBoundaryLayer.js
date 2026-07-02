import VectorSource from 'ol/source/Vector'
import VectorLayer from 'ol/layer/Vector'
import GeoJSON from 'ol/format/GeoJSON'
import { Style, Fill, Stroke } from 'ol/style'

export async function loadBoundaryGeoJson(onError) {
  try {
    const response = await fetch('/beibu-gulf-merged-data.geojson')
    if (!response.ok) {
      throw new Error('边界数据加载失败')
    }
    const geojson = await response.json()
    geojson.features.forEach((f) => {
      f.properties.featureType = 'boundary'
    })
    return geojson
  } catch (error) {
    console.error('边界数据加载失败:', error)
    onError?.('边界数据加载失败，图层可能缺失')
    return null
  }
}

export function buildBoundaryLayer(onError) {
  const source = new VectorSource({
    url: '/beibu-gulf-merged-data.geojson',
    format: new GeoJSON(),
  })
  source.on('featuresloaderror', () => {
    console.error('边界数据加载失败')
    onError?.('边界数据加载失败，图层可能缺失')
  })
  return new VectorLayer({
    source,
    style: new Style({
      stroke: new Stroke({ color: '#4dabf7', width: 2 }),
      fill: new Fill({ color: 'rgba(77,171,247,0.15)' }),
    }),
  })
}

export const BOUNDARY_STYLE = {
  strokeColor: '#4dabf7',
  strokeWidth: 2,
  fillColor: 'rgba(77,171,247,0.15)',
  featureType: 'boundary',
}