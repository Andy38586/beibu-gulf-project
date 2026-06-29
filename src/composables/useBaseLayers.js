import TileLayer from 'ol/layer/Tile'
import XYZ from 'ol/source/XYZ'

const TIANDITU_KEY = 'e4cef34602f9d6226f7d142990ab614e'

function buildTiandituLayer(layerCode) {
  return new TileLayer({
    source: new XYZ({
      url: `https://t0.tianditu.gov.cn/DataServer?T=${layerCode}&x={x}&y={y}&l={z}&tk=${TIANDITU_KEY}`,
      crossOrigin: 'anonymous',
    }),
  })
}
export function useBaseLayers(map) {
  const existingBaseLayers = []
  map.getLayers().forEach((layer) => {
    if (layer.get('isBaseMap')) {
      existingBaseLayers.push(layer)
    }
  })
  if (existingBaseLayers.length > 0) {
    function switchBaseMap(type) {
      map.getLayers().forEach((layer) => {
        if (layer.get('isBaseMap')) {
          layer.setVisible(layer.get('baseType') === type)
        }
      })
    }
    return { switchBaseMap }
  }
  const imageLayers = [buildTiandituLayer('img_w'), buildTiandituLayer('cia_w')]
  const vectorLayers = [buildTiandituLayer('vec_w'), buildTiandituLayer('cva_w')]
  imageLayers.forEach((l) => {
    l.set('isBaseMap', true)
    l.set('baseType', 'image')
    map.addLayer(l)
  })
  vectorLayers.forEach((l) => {
    l.set('isBaseMap', true)
    l.set('baseType', 'vector')
    l.setVisible(false)
    map.addLayer(l)
  })
  function switchBaseMap(type) {
    map.getLayers().forEach((layer) => {
      if (layer.get('isBaseMap')) {
        layer.setVisible(layer.get('baseType') === type)
      }
    })
  }
  return { switchBaseMap }
}
