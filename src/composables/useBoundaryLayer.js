import VectorSource from 'ol/source/Vector'
import VectorLayer from 'ol/layer/Vector'
import GeoJSON from 'ol/format/GeoJSON'
import { Style, Fill, Stroke } from 'ol/style'

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
