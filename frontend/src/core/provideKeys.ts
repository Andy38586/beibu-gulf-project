/**
 * 跨组件 provide / inject 注入键（InjectionKey）
 * 用类型化 InjectionKey 替代字符串 key：
 * 1. key 拼写错误在编译期暴露，不再靠运行时 undefined 排查；
 * 2. 消费方不再需要手动类型断言（ref<T|null> 由 provider 端保证）；
 * 3. 与 App.vue 的 4 个 provide 一一对应。
 * 对应消费方：
 * - RESTORE_PLAN_DATA_KEY / EDITING_PLAN_KEY → ProfilePage
 * - UNIFIED_MAP_KEY → useMapControls
 * - MAP_STORE_KEY → useLayerManager
 */
import type { InjectionKey, Ref } from 'vue'

import type { MapRenderer } from '@/core/map/renderers/MapRenderer'
import type { useMapStore } from '@/stores'
import type { FlyToOptions, FlyToTarget } from '@/types'
import type { TypeSetting } from '@/types/facility'
import type { Plan } from '@/types/plan'

/** UnifiedMap 组件通过 defineExpose 暴露的地图控制接口（与 UnifiedMap.vue 暴露成员一致） */
export interface UnifiedMapExposed {
  flyTo: (target: FlyToTarget, options?: FlyToOptions) => void
  startBreathing: (lng: number, lat: number) => void
  stopBreathing: () => void
  getRenderer: () => MapRenderer | null
}

/** 计划恢复数据（编辑 / 加载计划时暂存，供 ProfilePage 消费） */
export const RESTORE_PLAN_DATA_KEY: InjectionKey<Ref<Record<string, TypeSetting> | null>> =
  Symbol('restorePlanData')

/** 当前编辑中的计划 */
export const EDITING_PLAN_KEY: InjectionKey<Ref<Plan | null>> = Symbol('editingPlan')

/** UnifiedMap 组件实例（defineExpose 暴露的地图控制接口） */
export const UNIFIED_MAP_KEY: InjectionKey<Ref<UnifiedMapExposed | null>> = Symbol('unifiedMap')

/** mapStore 实例（由 useMapStore 推断） */
export const MAP_STORE_KEY: InjectionKey<ReturnType<typeof useMapStore>> = Symbol('mapStore')
