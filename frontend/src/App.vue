<script setup lang="ts">
import { onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'

import { BusinessLayerManager } from '@/core'
import { BUSINESS_LAYER_MANAGER_KEY } from '@/core'
import { useMapControls } from '@/core'
import { registerNavItems } from '@/core'
import { businessModules } from '@/business/manifest'
import {
  EDITING_PLAN_KEY,
  MAP_STORE_KEY,
  RESTORE_PLAN_DATA_KEY,
  UNIFIED_MAP_KEY,
  type UnifiedMapExposed,
} from '@/core'
import UnifiedMap from '@/core/map/UnifiedMap.vue'
import { preloadCesium } from '@/core/map/renderers'
import {
  initAuthStorageListener,
  removeAuthStorageListener,
  showWarning,
  useAuth,
} from '@/shared'
import { logger } from '@/shared'
import ErrorBoundary from '@/shared/components/ErrorBoundary.vue'
import { useFloodStore } from '@/stores'
import { useForecastStore } from '@/stores'
import { useMapStore } from '@/stores'
import { siteSelectionPersisted } from '@/stores'
import type { TypeSetting } from '@/types/facility'
import type { Plan } from '@/types/plan'

const route = useRoute()
const router = useRouter()
// P9：user 供 watch 驱动 store 重置（登出/多标签页登出）
const { restoreAuth, user: authUser } = useAuth()
const { zoomToRegion, zoomToCity, stopBreathing } = useMapControls()
const mapStore = useMapStore()

const unifiedMapRef = ref<UnifiedMapExposed | null>(null)
const restorePlanData = ref<Record<string, TypeSetting> | null>(null)
const editingPlan = ref<Plan | null>(null)

provide(RESTORE_PLAN_DATA_KEY, restorePlanData)
provide(EDITING_PLAN_KEY, editingPlan)
provide(UNIFIED_MAP_KEY, unifiedMapRef)
// 提供 mapStore 给所有子组件（含 UnifiedMap 和 RouterView 下的业务页面）
provide(MAP_STORE_KEY, mapStore)

// 提供 BusinessLayerManager — 必须在 App.vue 而非 UnifiedMap，
// 因为 RouterView 下的业务组件是 UnifiedMap 的兄弟节点，不是子节点
const businessLayerManager = new BusinessLayerManager(mapStore)
provide(BUSINESS_LAYER_MANAGER_KEY, businessLayerManager)

// 图层渲染失败 → UI 层 toast（2026-08-08：manager 只上报错误回调、不感知 UI——
// 展示方式由上层决定；原 on/_emit 事件发射器已收敛为 setErrorHandler 单一回调）
businessLayerManager.setErrorHandler(({ label }: { label: string }) => {
  showWarning(`图层「${label}」加载失败，请再点击一次重试`)
})

// store 重置（2026-08-08 P9）：去掉 setResetStoresHandler 注册回调——
// 重置逻辑整合进 App.vue 组件内，watch(user) 驱动（user 变 null = 登出/多标签页登出）
function resetStores(): void {
  try {
    siteSelectionPersisted.clearState()
    // P3：waterLevel/portImpact/profile 已并入 floodStore，clearState 全量清（含持久化快照）
    useFloodStore().clearState()
    // 重置地图业务交互状态，清 analysisHandler 闭包与 sessionStorage
    useMapStore().resetMapState()
    // 预测页状态复位（含 dataCache 清空）
    useForecastStore().reset()
  } catch {
    // store 未激活等异常不阻断登出
  }
}
watch(
  () => authUser.value,
  (u) => {
    if (!u) resetStores()
  }
)

// 注册底部导航项：首页/个人中心为静态项,业务项由 manifest 生成（z075）
// core/layout 不硬编码业务路由；新增业务只改 business/manifest.ts
registerNavItems([
  { label: '首页', icon: '⌂', path: '/', disabled: false },
  ...businessModules.map((m) => ({
    label: m.navLabel,
    icon: m.navIcon,
    path: m.path,
    disabled: !!m.navDisabled,
  })),
  { label: '个人中心', icon: '👤', path: '/profile', disabled: false },
])

function handleRequireLogin() {
  void router.push('/profile')
}

// 等待渲染器就绪后再执行缩放
function waitForRenderer(callback: () => void, retries = 0) {
  const renderer = unifiedMapRef.value?.getRenderer?.()
  if (renderer) {
    callback()
  } else if (retries < 10) {
    setTimeout(() => waitForRenderer(callback, retries + 1), 500)
  }
}

/**
 * 合并路由监听器：统一处理路由变化和地图引擎切换
 * 关键修复：避免 route.name watcher 在引擎切换时覆盖 importState 设置的相机位置
 * 通过检测 meta.engine 是否变化来区分"路由导航"和"引擎切换"
 */
watch(
  () => ({
    name: route.name,
    engine: route.meta?.engine,
  }),
  (newRoute, oldRoute) => {
    stopBreathing()

    // 检测是否是引擎切换场景（engine 发生变化）
    const isEngineSwitch =
      oldRoute?.engine && newRoute.engine && oldRoute.engine !== newRoute.engine

    logger.debug('[App.vue] route watcher triggered:', {
      newName: newRoute.name,
      oldName: oldRoute?.name,
      newEngine: newRoute.engine,
      oldEngine: oldRoute?.engine,
      isEngineSwitch,
    })

    // 更新地图引擎类型
    const engine = newRoute.engine as string
    if (engine && ['2d', '3d'].includes(engine)) {
      mapStore.setMapType(engine as '2d' | '3d')
    }

    // 关键修复：仅在非引擎切换场景下执行相机重置
    // 引擎切换时，相机位置由 UnifiedMap 的 importState 管理
    if (!isEngineSwitch) {
      if (newRoute.name === 'Home') {
        waitForRenderer(zoomToRegion)
      }
      if (newRoute.name === 'SiteSelection') {
        waitForRenderer(zoomToCity)
      }
    } else {
      logger.debug('[App.vue] 引擎切换场景，跳过相机重置（由 importState 管理）')
    }
  },
  { immediate: true }
)

// 引擎切换（2D↔3D）后，旧 renderer 销毁、新 renderer 上没有业务图层。
// registry 在 App 级持久，业务页面不会因切换而重新 register，
// 因此监听 currentRenderer 变化，清理两个渲染器上残留的业务图层视觉实例：
// OL/Cesium 实例长期复用不销毁，否则上一个页面留在非激活渲染器上的孤儿图层
// （如 dem-hillshade GeoTIFF）会在切回该引擎时被渲染并崩掉渲染循环。
// 注意：业务图层重建不在此处做——统一由 UnifiedMap.initRenderer 尾部 reapplyAll
// 负责（在 setupLayers 之后，保证"清 catalog → 重建条目"顺序，且单测无 App.vue
// 也能重建；此处若也 reapplyAll 会与 initRenderer 重复 create 导致图层叠加）。
//
// flush: 'sync' 关键（2026-08-08）：Vue watch 默认 flush:'pre' 异步执行——
// setCurrentRenderer 触发 watcher 但回调被排入微任务队列，reapplyAll 同步执行
// 先于 watcher → 图层创建后立即被 watcher 的 removeAllFromRenderer 删除。
// Cesium boundary 因 addGeoJsonLayer 是 async（_layers 未 set）逃过删除，
// 而 ports/OL boundary 因同步 add 被删 → "2D 不显示"+"面板蓝但图上没有"。
// 改为 flush:'sync' 后 watcher 在 setCurrentRenderer 调用栈内同步执行，
// 先于 reapplyAll → 清理孤儿图层 → reapplyAll 重建，顺序正确。
watch(
  () => mapStore.currentRenderer,
  (renderer, oldRenderer) => {
    if (!renderer) return
    if (oldRenderer && oldRenderer !== renderer) {
      businessLayerManager.removeAllFromRenderer(oldRenderer)
      businessLayerManager.removeAllFromRenderer(renderer)
    }
  },
  { flush: 'sync' }
)

onMounted(() => {
  // 应用启动时恢复认证状态
  // 通过 /api/auth/me 验证 Cookie 中的 Token 是否有效
  void restoreAuth()
  // 单点注册多标签页 storage 同步监听（无需组件上下文，不会抛错）
  initAuthStorageListener()
  // Phase 2：首屏后空闲预取 Cesium 脚本（5.7MB），进 3D 时 warm，灭切换卡顿
  preloadCesium()
})

onUnmounted(() => {
  // 根组件卸载时销毁图层管理器，释放 _registry 持有的图层元数据
  businessLayerManager.destroy()
  // 解除多标签页 storage 监听（与 initAuthStorageListener 配对）
  removeAuthStorageListener()
})
</script>

<template>
  <div class="app-layout">
    <ErrorBoundary>
      <UnifiedMap ref="unifiedMapRef" :map-type="mapStore.mapType" />
    </ErrorBoundary>
    <main class="app-content">
      <ErrorBoundary>
        <RouterView v-slot="{ Component }">
          <component :is="Component" @require-login="handleRequireLogin" />
        </RouterView>
      </ErrorBoundary>
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  position: relative;
  height: 100vh;
}
.app-content {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  pointer-events: none;
  z-index: 50;
}
/* 注意：不能在这里设置 .app-content > * { pointer-events: auto } */
/* 原因：这会让 .flood-analysis-page 等业务页面也变成 pointer-events: auto， */
/* 导致整个页面成为全屏事件拦截层，阻挡下层地图容器的鼠标事件（拖拽/缩放/旋转失效） */
/* 正确做法：由各业务页面自行控制 pointer-events，面板通过 AppLayout 的 .app-layout > * 恢复 */
</style>
