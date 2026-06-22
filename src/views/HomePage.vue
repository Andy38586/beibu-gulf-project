<script setup>
import { ref } from 'vue'
import MapContainer from '@/components/map/MapContainer.vue'
import InfoPanel from '@/components/common/InfoPanel.vue'

const selectedPort = ref(null)
</script>

<template>
  <div class="home-page">
    <MapContainer v-model:selectedPort="selectedPort" style="width: 100%; height: 100%" />
    <InfoPanel v-if="selectedPort" :selectedPort="selectedPort" />
  </div>
</template>

<style scoped>
.home-page {
  width: 100%;
  height: 100%;
}
</style>
