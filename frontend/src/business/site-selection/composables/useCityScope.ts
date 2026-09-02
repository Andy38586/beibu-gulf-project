/**
 * 选址城市作用域：由当前地图视图反推「正在看哪个城市」，决定用哪一套 POI 做分析。
 *
 * 设计取舍（为什么不存"当前城市"全局状态）：
 *   city 若作为全局状态，点击城市按钮与拖动地图两条路径会各自写它，出现双写与漂移。
 *   改为单一事实源 = 地图相机：按钮 flyTo 改变相机 → 相机决定城市 → 选址读同一份判定。
 *   因此这里不引入任何 store，只做纯函数判定 + 一个相机订阅。
 *
 * bbox 来源：backend/data/site-selection/{city}_*.json 三城 POI 实际分布外接矩形。
 * 2026-08-30 市区口径清洗（tools/clean-poi-scope.mjs）后重算：删离岛（涠洲岛 80 点）
 * 与深山镇（fcg 峒中/那良 60 点、qz 那思/板城 131 点），否则 bbox 被撑大失真
 * （旧值 bh 南界 21.0133 / fcg 西界 107.5017 / qz 东界 109.05）。数据变了需同步重算。
 */
import { onUnmounted, type Ref, ref } from 'vue'

import { useWaitForRenderer } from '@/shared'
import type { CameraState } from '@/types/renderer'

export type CityKey = 'qz' | 'bh' | 'fcg'

export interface CityScope {
  key: CityKey
  label: string
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number]
}

export const CITY_SCOPES: CityScope[] = [
  { key: 'qz', label: '钦州市区', bbox: [108.2198, 21.5996, 108.9415, 22.2478] },
  { key: 'bh', label: '北海市区', bbox: [109.0493, 21.4061, 109.5752, 21.6648] },
  { key: 'fcg', label: '防城港市区', bbox: [108.0045, 21.5073, 108.5674, 21.9465] },
]

/** CityKey → core/config/map.ts CITY_CENTERS 的中文键（分析完成定位用，勿复制坐标值） */
export const CITY_CENTER_NAMES: Record<CityKey, '钦州' | '北海' | '防城港'> = {
  qz: '钦州',
  bh: '北海',
  fcg: '防城港',
}

// 视图过大阈值：低于此缩放（或高于此相机高度）视为跨城视野，不做单城判定
// 参考 core/config/map.ts CITY_CENTERS 的 zoom 11 / height 100000 —— 城市级视野
const MIN_ZOOM = 9.5
const MAX_HEIGHT = 300000

function inBbox(scope: CityScope, lng: number, lat: number): boolean {
  const [minLng, minLat, maxLng, maxLat] = scope.bbox
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat
}

/** 到 bbox 中心的粗略平面距离（度），仅用于重叠区择优，无需精确测地距离 */
function distanceToCenter(scope: CityScope, lng: number, lat: number): number {
  const [minLng, minLat, maxLng, maxLat] = scope.bbox
  const cx = (minLng + maxLng) / 2
  const cy = (minLat + maxLat) / 2
  return (lng - cx) ** 2 + (lat - cy) ** 2
}

/**
 * 由相机状态判定当前城市；无法确定时返回 null（跨城视野 / 视野不在三城范围内）。
 * 返回 null 时调用方应提示用户放大到单个城市，而不是静默用默认城市的数据。
 */
export function resolveCity(camera: CameraState | null | undefined): CityKey | null {
  if (!camera?.center) return null
  const { lng, lat } = camera.center
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null

  // 2D 用 zoom、3D 用 height，各自只在有值时生效
  if (typeof camera.zoom === 'number' && Number.isFinite(camera.zoom) && camera.zoom < MIN_ZOOM) {
    return null
  }
  if (
    typeof camera.zoom !== 'number' &&
    typeof camera.height === 'number' &&
    Number.isFinite(camera.height) &&
    camera.height > MAX_HEIGHT
  ) {
    return null
  }

  const hits = CITY_SCOPES.filter((s) => inBbox(s, lng, lat))
  if (hits.length === 0) return null
  if (hits.length === 1) return hits[0].key
  // 钦州与北海 bbox 在 lng 109.05 附近轻微重叠（大风江口），取中心更近者
  return hits.reduce((best, s) =>
    distanceToCenter(s, lng, lat) < distanceToCenter(best, lng, lat) ? s : best
  ).key
}

export function cityLabel(key: CityKey | null): string {
  return CITY_SCOPES.find((s) => s.key === key)?.label ?? ''
}

/**
 * 订阅渲染器相机变化，实时维护「当前城市」。
 * 相机事件本身已 300ms 防抖（OLRenderer/CesiumRenderer），此处不做二次节流。
 */
export function useCityScope(
  getRenderer: () => {
    on?: (e: string, h: (ev: CustomEvent) => void) => void
    off?: (e: string, h: (ev: CustomEvent) => void) => void
  } | null
): {
  currentCity: Ref<CityKey | null>
} {
  const currentCity = ref<CityKey | null>(null)
  let bound = false

  const handler = (event: Event) => {
    const camera = (event as CustomEvent<CameraState>).detail
    currentCity.value = resolveCity(camera)
  }

  // 渲染器可能晚于组件挂载就绪（引擎切换/异步初始化）。用公共 useWaitForRenderer
  //（500ms×10 有限重试，组件卸载自动取消）替代手写 interval 轮询
  useWaitForRenderer(
    () => {
      const renderer = getRenderer()
      if (!renderer?.on || bound) return false
      renderer.on('camera-changed', handler)
      bound = true
      return true
    },
    () => {}
  )

  onUnmounted(() => {
    const renderer = getRenderer()
    if (renderer?.off && bound) renderer.off('camera-changed', handler)
  })

  return { currentCity }
}
