export const MAP_CONFIG = {
  TIANDITU_KEY: import.meta.env.VITE_TIANDITU_KEY || 'e4cef34602f9d6226f7d142990ab614e',
  BASE_LAYERS: {
    image: {
      name: '影像底图',
      layers: ['img_w', 'cia_w'],
    },
    vector: {
      name: '矢量底图',
      layers: ['vec_w', 'cva_w'],
    },
  },
  TIANDITU_URL: 'https://t0.tianditu.gov.cn/DataServer?T={layerCode}&x={x}&y={y}&l={z}&tk={key}',
  DATA_PATHS: {
    ports: '/data/ports.json',
    boundary: '/beibu-gulf-merged-data.geojson',
  },
  CAMERA: {
    center: { lng: 108.5752963, lat: 21.760409, height: 10000 },
    heading: 0,
    pitch: -60,
    roll: 0,
  },
}

export function buildTiandituUrl(layerCode) {
  return MAP_CONFIG.TIANDITU_URL.replace('{layerCode}', layerCode).replace(
    '{key}',
    MAP_CONFIG.TIANDITU_KEY,
  )
}
