import type { InjectionKey, Ref } from 'vue'

import type { MapRenderer } from '@/core/map/renderers/MapRenderer'

/** 当前渲染器注入 key（UnifiedMap provide / 业务组件 inject） */
export const MapRendererKey: InjectionKey<Ref<MapRenderer | null>> = Symbol('mapRenderer')
