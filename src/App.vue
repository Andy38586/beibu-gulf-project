<script setup>
import { RouterView, useRoute, useRouter } from 'vue-router'
import { onMounted, provide, ref, watch } from 'vue'
import UnifiedMap from '@/core/map/UnifiedMap.vue'
import ErrorBoundary from '@/shared/components/ErrorBoundary.vue'
import { useAuth } from '@/shared/composables/useAuth'
import { useMapControls } from '@/core/map/composables/useMapControls'
import { useMapStore } from '@/stores/map'

const route = useRoute()
const router = useRouter()
const { restoreAuth } = useAuth()
const { zoomToRegion, zoomToCity, stopBreathing } = useMapControls()
const mapStore = useMapStore()

const unifiedMapRef = ref(null)
const restorePlanData = ref(null)
const editingPlan = ref(null)

provide('restorePlanData', restorePlanData)
provide('editingPlan', editingPlan)
provide('unifiedMap', unifiedMapRef)
// 提供 mapStore 给所有子组件（含 UnifiedMap 和 RouterView 下的业务页面）
provide('mapStore', mapStore)

function handleRequireLogin() {
  router.push('/profile')
}

// P1-001-FIX: 等待渲染器就绪后再执行缩放
function waitForRenderer(callback, retries = 0) {
  const renderer = unifiedMapRef.value?.getRenderer?.()
  if (renderer) {
    callback()
  } else if (retries < 10) {
    setTimeout(() => waitForRenderer(callback, retries + 1), 500)
  }
}

watch(
  () => route.name,
  (name) => {
    stopBreathing()
    if (name === 'Home') {
      waitForRenderer(zoomToRegion)
    }
    if (name === 'SiteSelection') {
      waitForRenderer(zoomToCity)
    }
  },
  { immediate: true },
)

/**
 * 地图引擎由路由元信息决定，禁止业务组件手动切换。
 * 未来新增 3D 路由时，只需在 route.meta 中声明 engine: '3d'。
 */
watch(
  () => route.meta?.engine,
  (engine) => {
    if (engine && ['2d', '3d'].includes(engine)) {
      mapStore.setMapType(engine)
    }
  },
  { immediate: true },
)

onMounted(() => {
  // P1-002-FIX: 应用启动时恢复认证状态
  // 通过 /api/auth/me 验证 Cookie 中的 Token 是否有效
  restoreAuth()
})
</script>

<template>
  <div class="app-layout">
    <UnifiedMap ref="unifiedMapRef" :map-type="mapStore.mapType" />
    <main class="app-content">
      <ErrorBoundary>
        <RouterView v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" @require-login="handleRequireLogin" />
          </transition>
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
/* 原因：这会让 .gcs-analysis-page 等业务页面也变成 pointer-events: auto， */
/* 导致整个页面成为全屏事件拦截层，阻挡下层地图容器的鼠标事件（拖拽/缩放/旋转失效） */
/* 正确做法：由各业务页面自行控制 pointer-events，面板通过 AppLayout 的 .app-layout > * 恢复 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 1s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
