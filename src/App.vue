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
const { checkAuth } = useAuth()
const { zoomToRegion, zoomToCity, stopBreathing } = useMapControls()
const mapStore = useMapStore()

const unifiedMapRef = ref(null)
const restorePlanData = ref(null)
const editingPlan = ref(null)

provide('restorePlanData', restorePlanData)
provide('editingPlan', editingPlan)
provide('unifiedMap', unifiedMapRef)

function handleRequireLogin() {
  router.push('/profile')
}

watch(
  () => route.name,
  (name) => {
    stopBreathing()
    if (name === 'Home') {
      zoomToRegion()
    }
    if (name === 'SiteSelection') {
      setTimeout(() => zoomToCity(), 500)
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
  checkAuth()
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
.app-content > * {
  pointer-events: auto;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 1s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
