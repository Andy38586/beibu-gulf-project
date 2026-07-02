<script setup>
import { RouterView, useRoute, useRouter } from 'vue-router'
import { onMounted, provide, ref, watch } from 'vue'
import AppHeader from '@/components/common/AppHeader.vue'
import ProfilePanel from '@/components/user/ProfilePanel.vue'
import UnifiedMap from '@/components/map/UnifiedMap.vue'
import LayerPanel from '@/components/map/LayerPanel.vue'
import MapSwitcher from '@/components/map/MapSwitcher.vue'
import { useLayerManager } from '@/composables/useLayerManager'
import { useAuth } from '@/composables/useAuth'
import { useMapStore } from '@/stores/map'

const route = useRoute()
const router = useRouter()
const { activate } = useLayerManager()
const { checkAuth } = useAuth()
const mapStore = useMapStore()

const showProfile = ref(false)
const restorePlanData = ref(null)
const editingPlan = ref(null)

provide('restorePlanData', restorePlanData)
provide('editingPlan', editingPlan)

watch(
  () => route.name,
  (name) => {
    activate(name?.toLowerCase())
  },
  { immediate: true },
)

function openProfile() {
  if (route.path === '/buffer') {
    router.push('/')
  }
  showProfile.value = true
}

function handleLoadPlan(plan) {
  restorePlanData.value = plan.typeSettings || {}
  editingPlan.value = plan
  router.push('/buffer')
  showProfile.value = false
}

onMounted(() => {
  checkAuth()
})
</script>

<template>
  <div class="app-layout">
    <UnifiedMap :map-type="mapStore.mapType" />
    <AppHeader @open-profile="openProfile" />
    <LayerPanel />
    <MapSwitcher />
    <main class="app-content">
      <RouterView v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </RouterView>
    </main>
    <ProfilePanel :visible="showProfile" @close="showProfile = false" @load-plan="handleLoadPlan" />
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
