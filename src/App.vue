<script setup>
import { RouterView, useRoute, useRouter } from 'vue-router'
import { onMounted, provide, ref, watch } from 'vue'
import AppHeader from '@/components/common/AppHeader.vue'
import UnifiedMap from '@/components/map/UnifiedMap.vue'
import LayerPanel from '@/components/map/LayerPanel.vue'
import MapSwitcher from '@/components/map/MapSwitcher.vue'
import ErrorBoundary from '@/components/common/ErrorBoundary.vue'
import { useAuth } from '@/composables/useAuth'
import { useMapControls } from '@/composables/useMapControls'
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
    if (name === 'Buffer') {
      setTimeout(() => zoomToCity(), 500)
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
    <AppHeader />
    <LayerPanel />
    <MapSwitcher />
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
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
