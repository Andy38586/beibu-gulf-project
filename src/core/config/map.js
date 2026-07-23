// BUGFIX-P3-07: 天地图 KEY 仅从环境变量读取，缺失时显式报错
const TIANDITU_KEY = import.meta.env.VITE_TIANDITU_KEY
if (!TIANDITU_KEY) {
  console.error('[map/config] 缺少 VITE_TIANDITU_KEY 环境变量，天地图底图将无法加载')
}

export const MAP_CONFIG = {
  TIANDITU_KEY,
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
  VIEW_LEVELS: {
    REGION: {
      center: { lng: 108.5752963, lat: 21.760409 },
      height: 800000,
      zoom: 9,
      label: '北部湾区域',
    },
    CITY: {
      center: { lng: 108.61, lat: 21.94 },
      height: 80000,
      zoom: 12,
      label: '钦州市',
    },
    DISTRICT: {
      center: { lng: 108.61, lat: 21.94 },
      height: 8000,
      zoom: 14,
      label: '区级',
    },
  },
}

export function buildTiandituUrl(layerCode) {
  return MAP_CONFIG.TIANDITU_URL.replace('{layerCode}', layerCode).replace(
    '{key}',
    MAP_CONFIG.TIANDITU_KEY,
  )
}

/**
 * 相机 zoom ↔ height 互逆转换
 *
 * zoom↔height 经验公式（基于 MAP_CONFIG.VIEW_LEVELS 校准）：
 *   height = 300000000 / 2^zoom
 *   zoom   = log2(300000000 / height)
 *
 * zoom=9  → 585938m ≈ 586km (接近 REGION 的 800km)
 * zoom=12 → 73242m  ≈ 73km  (接近 CITY 的 80km)
 * zoom=14 → 18311m  ≈ 18km  (接近 DISTRICT 的 8km)
 */

/** zoom → height（OL → Cesium） */
export function zoomToHeight(zoom) {
  return 300000000 / Math.pow(2, zoom)
}

/** height → zoom（Cesium → OL） */
export function heightToZoom(height) {
  const safeHeight = Math.max(200, height)
  return Math.log2(300000000 / safeHeight)
}
