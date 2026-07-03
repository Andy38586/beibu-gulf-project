<script setup>
import { ref, inject, onUnmounted, watch, computed } from 'vue'
import BufferControl from '@/components/analysis/BufferControl.vue'
import ResultPanel from '@/components/analysis/ResultPanel.vue'
import RadarFloatPanel from '@/components/analysis/RadarFloatPanel.vue'
import { useMapStore } from '@/stores/map'
import { MAP_CONFIG } from '@/config/map'

const emit = defineEmits(['require-login'])

const mapStore = useMapStore()
const matchedXiaoqu = ref([])
const selectedTypes = ref([])
const selectedXiaoqu = ref(null)

const unifiedMapRef = inject('unifiedMap', ref(null))
const mapReady = ref(false)

const mapInstance = computed(() => unifiedMapRef.value)

function handleResult(result) {
  mapStore.setAnalysisResult(result)
  matchedXiaoqu.value = result.matchedXiaoqu || []
  selectedTypes.value = result.selectedTypes || []
  if (matchedXiaoqu.value.length > 0) {
    zoomToDistrict()
  }
}

function handleSelectXiaoqu(xq) {
  selectedXiaoqu.value = xq
  mapStore.setSelectedXiaoqu(xq)
  if (xq.lon && xq.lat) {
    mapInstance.value?.startBreathing(xq.lon, xq.lat)
    mapInstance.value?.flyTo({ lng: xq.lon, lat: xq.lat }, { height: 5000 })
  }
}

function handleCloseXiaoqu() {
  selectedXiaoqu.value = null
  mapStore.setSelectedXiaoqu(null)
  mapInstance.value?.stopBreathing()
}

function zoomToCity() {
  if (!mapReady.value) return
  const cityLevel = MAP_CONFIG.VIEW_LEVELS.CITY
  mapInstance.value?.flyTo(cityLevel.center, { height: cityLevel.height })
}

function zoomToDistrict() {
  if (!mapReady.value) return
  const districtLevel = MAP_CONFIG.VIEW_LEVELS.DISTRICT
  mapInstance.value?.flyTo(districtLevel.center, { height: districtLevel.height })
}

watch(unifiedMapRef, (val) => {
  if (val?.value) {
    mapReady.value = true
    setTimeout(() => zoomToCity(), 300)
  }
})

onUnmounted(() => {
  mapInstance.value?.stopBreathing()
})
</script>

<template>
  <div class="buffer-page">
    <div class="buffer-panel">
      <div class="panel-card">
        <BufferControl @result-update="handleResult" @require-login="emit('require-login')" />
      </div>
      <div class="panel-card">
        <div class="scroll-wrap">
          <ResultPanel
            :matched-xiaoqu="matchedXiaoqu"
            :selected-types="selectedTypes"
            @select-xiaoqu="handleSelectXiaoqu"
            @close-xiaoqu="handleCloseXiaoqu"
          />
        </div>
      </div>
    </div>
    <RadarFloatPanel
      :visible="!!selectedXiaoqu"
      :xiaoqu="selectedXiaoqu"
      :selected-types="selectedTypes"
      @close="handleCloseXiaoqu"
    />
  </div>
</template>

<style scoped>
.buffer-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.buffer-page :deep(.buffer-panel) {
  pointer-events: auto;
}
.buffer-page :deep(.radar-float-panel) {
  pointer-events: auto;
}
.buffer-panel {
  position: fixed;
  top: calc(9 * var(--unit));
  right: calc(2.5 * var(--unit));
  width: calc(39 * var(--unit));
  display: flex;
  flex-direction: column;
  gap: calc(1.5 * var(--unit));
  z-index: 55;
  pointer-events: auto;
  max-height: calc(100vh - calc(11 * var(--unit)));
  height: calc(100vh - calc(11 * var(--unit)));
}
.panel-card {
  background: rgba(255, 255, 255, 0.95);
  border-radius: calc(1.25 * var(--unit));
  box-shadow: 0 calc(0.5 * var(--unit)) calc(2.25 * var(--unit)) rgba(0, 0, 0, 0.2);
  padding: calc(1.5 * var(--unit));
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.panel-card:first-child {
  flex: none;
}

.panel-card:last-child {
  flex: 1;
  min-height: 0;
}

.scroll-wrap {
  height: 100%;
  overflow-y: auto;
}
</style>
