/**
 * 跨组件 provide / inject 注入键（InjectionKey）
 * 用类型化 InjectionKey 替代字符串 key：
 * 1. key 拼写错误在编译期暴露，不再靠运行时 undefined 排查；
 * 2. 消费方不再需要手动类型断言（ref<T|null> 由 provider 端保证）；
 * 3. 与 App.vue 的 provide 一一对应（BUSINESS_LAYER_MANAGER_KEY 定义于 map/composables/useBusinessLayers.ts）。
 * 对应消费方：
 * - UNIFIED_MAP_KEY → useMapControls
 */
import type { InjectionKey, Ref } from 'vue'

import type { MapRenderer } from '@/core/map/renderers/MapRenderer'
import type { FlyToOptions, FlyToTarget, GeoPoint } from '@/types'

/** UnifiedMap 组件通过 defineExpose 暴露的地图控制接口（与 UnifiedMap.vue 暴露成员一致） */
export interface UnifiedMapExposed {
  flyTo: (target: FlyToTarget, options?: FlyToOptions) => void
  startBreathing: (target: GeoPoint | GeoPoint[], color?: string) => void
  stopBreathing: () => void
  /** 设施 POI 专属呼吸（缩放式动效）：与 startBreathing（呼吸灯式）独立实例同屏并存；点可带 per-point color */
  startFacilityBreathing: (target: Array<GeoPoint & { color?: string }>, color?: string) => void
  stopFacilityBreathing: () => void
  getRenderer: () => MapRenderer | null
}

/** UnifiedMap 组件实例（defineExpose 暴露的地图控制接口） */
export const UNIFIED_MAP_KEY: InjectionKey<Ref<UnifiedMapExposed | null>> = Symbol('unifiedMap')
