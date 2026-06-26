<script setup>
import { ref, onMounted, provide } from 'vue'
import { RouterView } from 'vue-router'
import AppHeader from '@/components/common/AppHeader.vue'
import ErrorBoundary from '@/components/common/ErrorBoundary.vue'
import AuthModal from '@/components/auth/AuthModal.vue'
import PlanDrawer from '@/components/user/PlanDrawer.vue'
import { useAuth } from '@/composables/useAuth'

const showAuthModal = ref(false)
const showPlanDrawer = ref(false)
const restorePlanData = ref(null)
const editingPlan = ref(null)
const { checkAuth } = useAuth()

provide('restorePlanData', restorePlanData)
provide('editingPlan', editingPlan)

onMounted(() => {
  checkAuth()
})

function onLoadPlan(plan) {
  restorePlanData.value = { ...plan.typeSettings }
  showPlanDrawer.value = false
}

function onEditPlan(plan) {
  restorePlanData.value = { ...plan.typeSettings }
  editingPlan.value = { id: plan.id, name: plan.name }
  showPlanDrawer.value = false
}

function onOpenPlans() {
  showPlanDrawer.value = true
}
</script>

<template>
  <div class="app-layout">
    <AppHeader @open-login="showAuthModal = true" @open-plans="onOpenPlans" />
    <main class="app-content">
      <ErrorBoundary>
      <RouterView v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </RouterView>
      </ErrorBoundary>
    </main>
  </div>
  <AuthModal :visible="showAuthModal" @close="showAuthModal = false" />
  <PlanDrawer :visible="showPlanDrawer" @close="showPlanDrawer = false" @load-plan="onLoadPlan" @edit-plan="onEditPlan" />
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
