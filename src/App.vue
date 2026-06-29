<script setup>
import { RouterView, useRoute, useRouter } from 'vue-router'
import { onMounted, provide, ref, watch } from 'vue'
import AppHeader from '@/components/common/AppHeader.vue'
import AuthModal from '@/components/auth/AuthModal.vue'
import PlanDrawer from '@/components/user/PlanDrawer.vue'
import OlMap from '@/components/map/OlMap.vue'
import BaseLayerSwitcher from '@/components/map/BaseLayerSwitcher.vue'
import { useLayerManager } from '@/composables/useLayerManager'
import { useAuth } from '@/composables/useAuth'

const route = useRoute()
const router = useRouter()
const { activate } = useLayerManager()
const { checkAuth } = useAuth()

const showLogin = ref(false)
const showPlans = ref(false)
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
function handleLoadPlan(plan) {
  restorePlanData.value = plan.typeSettings || {}
  editingPlan.value = plan
  router.push('/buffer')
}
function handleEditPlan(plan) {
  handleLoadPlan(plan)
}
onMounted(() => {
  checkAuth()
})
</script>

<template>
  <div class="app-layout">
    <OlMap />
    <AppHeader @open-login="showLogin = true" @open-plans="showPlans = true" />
    <BaseLayerSwitcher />
    <main class="app-content">
      <RouterView v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </RouterView>
    </main>
    <AuthModal :visible="showLogin" @close="showLogin = false" />
    <PlanDrawer
      :visible="showPlans"
      @close="showPlans = false"
      @load-plan="handleLoadPlan"
      @edit-plan="handleEditPlan"
    />
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
