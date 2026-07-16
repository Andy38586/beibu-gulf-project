<script setup>
/**
 * SiteSelectionPage - 选址分析业务页
 *
 * 职责：承载选址分析完整链路，继承 Home Layout。
 * Phase 4-B：
 * - Zone2：固定雷达图面板（RadarFloatPanel embedded）
 * - Zone4：选址配置（BufferControl）+ 结果列表（ResultPanel）组合显示
 * - 路由 /buffer → /site-selection
 */

import { ref, inject, onUnmounted, watch, computed } from 'vue'
import AppLayout from '@/core/layout/AppLayout.vue'
import BufferControl from '@/business/site-selection/components/BufferControl.vue'
import ResultPanel from '@/business/site-selection/components/ResultPanel.vue'
import RadarFloatPanel from '@/visualization/charts/RadarChart.vue'
import { useMapStore } from '@/stores/map'
import { MAP_CONFIG } from '@/core/config/map'

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
  // 清空已选小区，雷达图回到空状态
  selectedXiaoqu.value = null
  mapStore.setSelectedXiaoqu(null)
  mapInstance.value?.stopBreathing()
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
    <AppLayout>
      <!-- Zone2：雷达图固定面板 -->
      <template #zone2>
        <RadarFloatPanel
          :embedded="true"
          :xiaoqu="selectedXiaoqu"
          :selected-types="selectedTypes"
        />
      </template>

      <!-- Zone4：选址配置 + 结果列表 -->
      <template #zone4>
        <div class="zone4-stack">
          <div class="buffer-control-wrap">
            <BufferControl
              @result-update="handleResult"
              @require-login="emit('require-login')"
            />
          </div>
          <div class="result-panel-wrap">
            <ResultPanel
              :matched-xiaoqu="matchedXiaoqu"
              :selected-types="selectedTypes"
              @select-xiaoqu="handleSelectXiaoqu"
              @close-xiaoqu="handleCloseXiaoqu"
            />
          </div>
        </div>
      </template>
    </AppLayout>
  </div>
</template>

<style scoped>
.site-selection-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* Zone4 内垂直堆叠：配置面板 + 结果列表，超出可滚动 */
.zone4-stack {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
  box-sizing: border-box;
}

.buffer-control-wrap,
.result-panel-wrap {
  flex-shrink: 0;
  pointer-events: auto;
}
</style>
