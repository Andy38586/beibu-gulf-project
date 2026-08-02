<script setup lang="ts">
import { onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'

import { BusinessLayerManager } from '@/core/map/BusinessLayerManager'
import { BUSINESS_LAYER_MANAGER_KEY } from '@/core/map/composables/useBusinessLayers'
import { useMapControls } from '@/core/map/composables/useMapControls'
import UnifiedMap from '@/core/map/UnifiedMap.vue'
import ErrorBoundary from '@/shared/components/ErrorBoundary.vue'
import {
  initAuthStorageListener,
  removeAuthStorageListener,
  useAuth,
} from '@/shared/composables/useAuth'
import { logger } from '@/shared/utils/logger'
import { useMapStore } from '@/stores/mapStore'

const route = useRoute()
const router = useRouter()
const { restoreAuth } = useAuth()
const { zoomToRegion, zoomToCity, stopBreathing } = useMapControls()
const mapStore = useMapStore()

const unifiedMapRef = ref<{ getRenderer: () => unknown } | null>(null)
const restorePlanData = ref(null)
const editingPlan = ref(null)

provide('restorePlanData', restorePlanData)
provide('editingPlan', editingPlan)
provide('unifiedMap', unifiedMapRef)
// 提供 mapStore 给所有子组件（含 UnifiedMap 和 RouterView 下的业务页面）
provide('mapStore', mapStore)

// 提供 BusinessLayerManager — 必须在 App.vue 而非 UnifiedMap，
// 因为 RouterView 下的业务组件是 UnifiedMap 的兄弟节点，不是子节点
const businessLayerManager = new BusinessLayerManager(mapStore)
provide(BUSINESS_LAYER_MANAGER_KEY, businessLayerManager)

function handleRequireLogin() {
  router.push('/profile')
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
 *
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
// 因此监听 currentRenderer 变化，把已注册且可见的图层重绘到新 renderer（修复 D06）。
// 切换前必须清空 old/new 两个渲染器上的业务图层视觉实例：OL/Cesium 实例长期复用不销毁，
// 否则上一个页面留在非激活渲染器上的孤儿图层（如 dem-hillshade GeoTIFF）会在切回该引擎时
// 被渲染并崩掉渲染循环，且 reapplyAll 重复 add 同 key 会叠加图层。
watch(
  () => mapStore.currentRenderer,
  (renderer, oldRenderer) => {
    if (renderer && oldRenderer && renderer !== oldRenderer) {
      businessLayerManager.removeAllFromRenderer(oldRenderer)
      businessLayerManager.removeAllFromRenderer(renderer)
      businessLayerManager.reapplyAll(renderer)
    }
  }
)

onMounted(() => {
  // 应用启动时恢复认证状态
  // 通过 /api/auth/me 验证 Cookie 中的 Token 是否有效
  restoreAuth()
  // 单点注册多标签页 storage 同步监听（无需组件上下文，不会抛错）
  initAuthStorageListener()
})

onUnmounted(() => {
  // a024: 根组件卸载时销毁图层管理器，释放 _registry 持有的图层元数据
  businessLayerManager.destroy()
  // z067: 解除多标签页 storage 监听（与 initAuthStorageListener 配对）
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
