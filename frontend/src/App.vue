<script setup lang="ts">
import { onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'

import { businessModules } from '@/business/manifest'
import { BusinessLayerManager } from '@/core'
import { BUSINESS_LAYER_MANAGER_KEY } from '@/core'
import { registerNavItems } from '@/core'
import { useMapControls } from '@/core'
import {
  EDITING_PLAN_KEY,
  MAP_STORE_KEY,
  RESTORE_PLAN_DATA_KEY,
  UNIFIED_MAP_KEY,
  type UnifiedMapExposed,
} from '@/core'
import { preloadCesium } from '@/core/map/renderers'
import UnifiedMap from '@/core/map/UnifiedMap.vue'
import { initAuthStorageListener, removeAuthStorageListener, showWarning, useAuth } from '@/shared'
import { logger } from '@/shared'
import ErrorBoundary from '@/shared/components/ErrorBoundary.vue'
import GCSModal from '@/shared/components/GCSModal.vue'
import GCSToast from '@/shared/components/GCSToast.vue'
import { useFloodStore } from '@/stores'
import { useForecastStore } from '@/stores'
import { useMapStore } from '@/stores'
import { siteSelectionPersisted } from '@/stores'
import type { TypeSetting } from '@/types/facility'
import type { Plan } from '@/types/plan'

const route = useRoute()
const router = useRouter()
// authUser 供 watch 驱动登出/多标签页登出时的 store 重置
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

// 图层渲染失败由 manager 回调上报，UI 展示方式由上层决定
businessLayerManager.setErrorHandler(({ label }: { label: string }) => {
  showWarning(`图层「${label}」加载失败，请再点击一次重试`)
})

// 登出/多标签页登出（authUser 变 null）时统一重置各业务 store
function resetStores(): void {
  try {
    siteSelectionPersisted.clearState()
    // 各业务状态已并入 floodStore，clearState 全量清（含持久化快照）
    useFloodStore().clearState()
    // 重置地图业务交互状态，清 lastAnalysisResult 会话持久化与 sessionStorage
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

function handleRequireLogin() {
  void router.push('/profile')
}

// 注册底部导航项：core/layout 不引 business，由根入口从 manifest 注入业务导航项（分层铁律）
registerNavItems([
  { type: 'home', label: '首页', icon: '⌂', path: '/', disabled: false },
  ...businessModules.map((m) => ({
    type: 'business' as const,
    label: m.navLabel,
    icon: m.navIcon,
    path: m.path,
    disabled: !!m.navDisabled,
  })),
  { type: 'profile', label: '个人中心', icon: '👤', path: '/profile', disabled: false },
])

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
 * 统一处理路由变化与引擎切换：检测 meta.engine 变化区分二者，
 * 避免引擎切换时 watcher 覆盖 importState 设置的相机位置
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

    // 仅非引擎切换场景执行相机重置（引擎切换时相机由 importState 管理）
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

// 引擎切换后旧 renderer 上残留的业务图层需清理（registry 在 App 级持久，页面不会重新 register）。
// 重建统一由 UnifiedMap.initRenderer 尾部的 reapplyAll 负责，此处只清不建，避免重复 create。
// flush:'sync' 关键：reapplyAll 在切换调用栈内同步执行，默认异步 watcher 会晚于它触发，
// 导致图层"先建后删"（2D 不显示）；同步 flush 保证"先清理、后重建"顺序。
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
  void restoreAuth() // 启动时经 /api/auth/me 验证 Cookie Token
  initAuthStorageListener() // 多标签页登录态同步
  preloadCesium() // 空闲预取 Cesium 脚本（5.7MB），降低进 3D 切换卡顿
})

onUnmounted(() => {
  businessLayerManager.destroy() // 释放图层注册表元数据
  removeAuthStorageListener() // 与 initAuthStorageListener 配对
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
    <!-- 全局 GCS 反馈层（统一提示组件，替换 ElMessageBox/ElMessage） -->
    <GCSModal />
    <GCSToast />
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
/* 不能设 .app-content > * { pointer-events: auto }：会让业务页面成为全屏事件拦截层，
   阻挡地图容器鼠标事件（拖拽/缩放/旋转失效）；由各业务页面自行控制，AppLayout 再恢复 */
</style>
