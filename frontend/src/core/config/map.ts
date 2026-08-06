// 天地图 KEY 仅从环境变量读取，缺失时显式报错
import { logger } from '@/shared'

const TIANDITU_KEY: string = import.meta.env.VITE_TIANDITU_KEY
if (!TIANDITU_KEY) {
  logger.error('[map/config] 缺少 VITE_TIANDITU_KEY 环境变量，天地图底图将无法加载')
}

/** 天地图底图图层配置 */
export interface MapBaseLayerConfig {
  name: string
  layers: string[]
}

/** 天地图底图集合 */
export interface MapBaseLayersConfig {
  image: MapBaseLayerConfig
  vector: MapBaseLayerConfig
}

/** 数据文件路径配置 */
export interface MapDataPaths {
  ports: string
  boundary: string
}

/** 相机中心点（含高度） */
export interface MapCameraCenter {
  lng: number
  lat: number
  height: number
}

/** 相机初始参数 */
export interface MapCameraConfig {
  center: MapCameraCenter
  heading: number
  pitch: number
  roll: number
}

/** 视图层级配置（区域 / 城市 / 区级） */
export interface MapViewLevel {
  center: { lng: number; lat: number }
  height: number
  zoom: number
  label: string
}

/** 视图层级集合 */
export interface MapViewLevels {
  REGION: MapViewLevel
  CITY: MapViewLevel
  DISTRICT: MapViewLevel
}

/** 地图全局配置 */
export interface MapConfig {
  TIANDITU_KEY: string
  BASE_LAYERS: MapBaseLayersConfig
  TIANDITU_URL: string
  DATA_PATHS: MapDataPaths
  CAMERA: MapCameraConfig
  VIEW_LEVELS: MapViewLevels
}

export const MAP_CONFIG: MapConfig = {
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
    // 港口数据已收归后端单源（backend/data/ports.json），经公开接口返回
    ports: '/api/ports',
    boundary: '/data/site-selection/boundary.geojson',
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
      height: 1600000,
      zoom: 9,
      label: '北部湾区域',
    },
    CITY: {
      center: { lng: 108.61, lat: 21.94 },
      height: 160000,
      zoom: 12,
      label: '钦州市',
    },
    DISTRICT: {
      center: { lng: 108.61, lat: 21.94 },
      height: 16000,
      zoom: 14,
      label: '区级',
    },
  },
}

export function buildTiandituUrl(layerCode: string): string {
  return MAP_CONFIG.TIANDITU_URL.replace('{layerCode}', layerCode).replace(
    '{key}',
    MAP_CONFIG.TIANDITU_KEY
  )
}

/**
 * 相机 zoom ↔ height 互逆转换
 * zoom↔height 经验公式（基于 MAP_CONFIG.VIEW_LEVELS 校准）：
 * height = 300000000 / 2^zoom
 * zoom   = log2(300000000 / height)
 * zoom=9  → 585938m ≈ 586km (接近 REGION 的 800km)
 * zoom=12 → 73242m  ≈ 73km  (接近 CITY 的 80km)
 * zoom=14 → 18311m  ≈ 18km  (接近 DISTRICT 的 8km)
 */

/** zoom → height（OL → Cesium） */
export function zoomToHeight(zoom: number): number {
  return 300000000 / Math.pow(2, zoom)
}

/** height → zoom（Cesium → OL） */
export function heightToZoom(height: number): number {
  const safeHeight = Math.max(200, height)
  return Math.log2(300000000 / safeHeight)
}
