import type { InjectionKey, Ref } from 'vue'

import type { MapRenderer } from '@/core/map/renderers/MapRenderer'

/**
 * 当前渲染器注入 key（UnifiedMap provide / 业务组件 inject）。
 * 2026-08-09：useMapRenderer() 函数零调用方死代码已删（业务组件均通过
 * mapStore.currentRenderer 或 useMapControls 访问渲染器），仅保留注入常量。
 */
export const MapRendererKey: InjectionKey<Ref<MapRenderer | null>> = Symbol('mapRenderer')
