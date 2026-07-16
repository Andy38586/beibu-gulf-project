<script setup>
/**
 * SiteSelectionPage - 选址分析业务页
 *
 * 职责：承载选址分析完整链路。
 * Phase 4-A：引入 AppLayout，将 BufferControl 迁移到 Zone4。
 * Phase 4-B：将继续迁移 ResultPanel 到 Zone4，RadarFloatPanel 到 Zone2。
 */

import { ref, inject, onUnmounted, watch, computed } from 'vue'
import AppLayout from '@/core/layout/AppLayout.vue'
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
  <div class="site-selection-page">
    <!-- Phase 4-A：业务配置面板放入 Zone4 -->
    <AppLayout>
      <template #zone4>
        <BufferControl @result-update="handleResult" @require-login="emit('require-login')" />
      </template>
    </AppLayout>

    <!-- Phase 4-B 待迁移：结果列表面板 -->
    <div class="result-panel-wrap">
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

    <!-- Phase 4-B 待迁移：雷达图浮窗 -->
    <RadarFloatPanel
      :visible="!!selectedXiaoqu"
      :xiaoqu="selectedXiaoqu"
      :selected-types="selectedTypes"
      @close="handleCloseXiaoqu"
    />
  </div>
</template>

<style scoped>
.site-selection-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.site-selection-page :deep(.result-panel-wrap),
.site-selection-page :deep(.radar-float-panel) {
  pointer-events: auto;
}

/* 临时容器：仅承载 ResultPanel，Phase 4-B 迁移到 Zone4 后删除。
   当前避开右下 Zone4（4×4 Cell ≈ 52×--unit），放在其上方。 */
.result-panel-wrap {
  position: fixed;
  top: calc(9 * var(--unit));
  right: calc(2.5 * var(--unit));
  bottom: calc(52 * var(--unit));
  width: calc(39 * var(--unit));
  z-index: 55;
  pointer-events: auto;
}

.panel-card {
  background: rgba(255, 255, 255, 0.95);
  border-radius: calc(1.25 * var(--unit));
  box-shadow: 0 calc(0.5 * var(--unit)) calc(2.25 * var(--unit)) rgba(0, 0, 0, 0.2);
  padding: calc(1.5 * var(--unit));
  overflow: hidden;
  display: flex;
  flex-direction: column;
  clip-path: inset(0 0 0 0 round calc(1.25 * var(--unit)));
  height: 100%;
}

.scroll-wrap {
  height: 100%;
  overflow-y: auto;
}
</style>
