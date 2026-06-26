<script setup>
import { RouterView } from 'vue-router'
import AppHeader from '@/components/common/AppHeader.vue'
import ErrorBoundary from '@/components/common/ErrorBoundary.vue'
</script>

<template>
  <div class="app-layout">
    <AppHeader />
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
