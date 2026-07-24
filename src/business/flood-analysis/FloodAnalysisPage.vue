<script setup>
// 浸没分析页面：4面板布局(左上报告/左下设施/右上剖面/右下水��)，Cesium引擎
import { onMounted, onUnmounted, watch, nextTick } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useFloodStateStore } from '@/stores/floodState'
import AppLayout from '@/core/layout/AppLayout.vue'
import GcsPanel from '@/core/layout/components/GcsPanel.vue'
import { useGcsStore } from '@/stores/gcsStore'
import { useWaterLevelStore } from '@/stores/waterLevelStore'
import { useFloodStore } from '@/stores/floodStore'
import { usePortImpactStore } from '@/stores/portImpactStore'
import { useMapStore } from '@/stores/map'
import { useBusinessLayers } from '@/core/map/composables/useBusinessLayers'
import { useApiRequest } from '@/shared/composables/useApiRequest'
import WaterLevelProfilePanel from './components/WaterLevelProfilePanel.vue'
import FloodAnalysisReportPanel from './components/FloodAnalysisReportPanel.vue'
import AffectedFacilityListPanel from './components/AffectedFacilityListPanel.vue'
import LayerControlPanel from '@/shared/components/LayerControlPanel.vue'
import { logger } from '@/shared/utils/logger'

const { apiRequest } = useApiRequest()
const gcsStore = useGcsStore()
const waterLevelStore = useWaterLevelStore()
const floodStore = useFloodStore()
const portImpactStore = usePortImpactStore()
const mapStore = useMapStore()
const { manager: businessLayerManager } = useBusinessLayers()

const floodStateStore = useFloodStateStore()

const route = useRoute()

function shouldRenderForCurrentRoute() {
  const expected = route.meta?.engine
  const actual = mapStore.currentRenderer?.getType?.()
  if (!expected || !actual) return false
  return expected === actual
}

/** 状态恢复标志：恢复状态时禁止 watch 触发重复 API 请求 */
let stateRestored = false

/** 防抖定时器 */
let analysisTimer = null

// 请求序号，仅最新响应写 store；防止切回2D后数据污染渲染器
let analysisSeq = 0
let unmounted = false

const ANALYSIS_DELAY = 500

const WATER_SURFACE_ID = 'gcs-water-surface'

const FLOOD_LAYER_ID = 'gcs-flood-area'
const FACILITY_LAYER_ID = 'gcs-facilities'

// FIX:P3-02: 钦州港附近水面坐标兜底，实际�� water-area.json 加载
const FALLBACK_WATER_AREA_COORDINATES = [
  [108.615, 21.855],
  [108.62, 21.855],
  [108.622, 21.858],
  [108.621, 21.862],
  [108.618, 21.863],
  [108.614, 21.861],
  [108.615, 21.855],
]

let cachedWaterAreaCoords = null

async function loadWaterAreaCoordinates() {
  if (cachedWaterAreaCoords) return cachedWaterAreaCoords
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    const res = await fetch('/data/water-area.json', { signal: controller.signal })
    clearTimeout(timeoutId)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    cachedWaterAreaCoords = data.coordinates
    return cachedWaterAreaCoords
  } catch {
    if (import.meta.env.DEV) {
      console.warn('[GCS] water-area.json 加载失败，使用兜底坐标')
    }
    return FALLBACK_WATER_AREA_COORDINATES
  }
}

/** 图层是否已注册（防止重复注册） */
let gcsLayersRegistered = false

// 注册业务图层到 BusinessLayerManager
// 首次 register 只建 catalog 条目，不渲染（数据尚未就绪）
// API 返回数据后通过 updateData 渲染
async function registerGcsLayers() {
  if (gcsLayersRegistered) return

  const waterCoords = await loadWaterAreaCoordinates()
  if (unmounted) return

  gcsLayersRegistered = true

  // 水面图层
  businessLayerManager.register(WATER_SURFACE_ID, {
    label: '水面',
    layerType: 'waterSurface',
    data: { coordinates: waterCoords, height: waterLevelStore.waterLevel },
    options: { color: 'rgba(64, 158, 255, 0.5)' },
    visible: true,
  })

  // 淹没范围图层（无初始数据，等待 API 返回）
  businessLayerManager.register(FLOOD_LAYER_ID, {
    label: '淹没范围',
    layerType: 'geojson',
    data: null,
    options: {},
    visible: true,
  })

  // 受影响设施图层（无初始数据，等待 API 返回）
  businessLayerManager.register(FACILITY_LAYER_ID, {
    label: '受影响设施',
    layerType: 'points',
    data: null,
    options: {},
    visible: true,
  })
}

// 渲染器就绪时自动注册图层到控制面板
watch(
  () => mapStore.currentRenderer,
  (renderer) => {
    if (renderer) {
      nextTick(() => {
        registerGcsLayers()
      })
    }
  },
  { immediate: true },
)

onBeforeRouteLeave((to) => {
  if (to.path === '/profile') {
    saveCurrentState()
  } else {
    floodStateStore.clearState()
  }
})

function saveCurrentState() {
  floodStateStore.saveState({
    waterLevel: waterLevelStore.waterLevel,
    floodStatistics: floodStore.floodStatistics,
    floodFeatures: floodStore.floodFeatures,
    floodRiskLevel: floodStore.floodRiskLevel,
    affectedFacilities: portImpactStore.affectedFacilities,
    totalLoss: portImpactStore.totalLoss,
  })
}

/**
 * 挂载时恢复保存的状态
 */
onMounted(() => {
  const savedState = floodStateStore.consumeState()
  if (savedState) {
    // 清除 {immediate: true} watch 已排入的防抖分析，避免恢复后覆盖
    if (analysisTimer) {
      clearTimeout(analysisTimer)
      analysisTimer = null
    }

    stateRestored = true

    waterLevelStore.setWaterLevel(savedState.waterLevel)

    if (savedState.floodStatistics) {
      floodStore.startFloodAnalysis(
        savedState.floodStatistics,
        savedState.floodFeatures,
        savedState.floodRiskLevel,
      )
    }

    if (savedState.affectedFacilities) {
      portImpactStore.setPortImpactResult(savedState.affectedFacilities, savedState.totalLoss)
    }

    stateRestored = false
  }
})

// 水位变化防抖500ms后自动触发淹没问题分析和影响评估
watch(
  () => waterLevelStore.waterLevel,
  (newLevel) => {
    if (stateRestored) return

    if (analysisTimer) {
      clearTimeout(analysisTimer)
    }

    analysisTimer = setTimeout(() => {
      // FIX:P2-02: 递增请求序号
      const seq = ++analysisSeq
      logger.debug('[GCS] 防抖结束，触发分析，水位:', newLevel, 'seq:', seq)
      triggerFloodAnalysis(newLevel, seq)
      triggerImpactAssessment(newLevel, seq)
    }, ANALYSIS_DELAY)
  },
  { immediate: true },
)

async function triggerFloodAnalysis(waterLevel, seq) {
  try {
    logger.debug('[GCS] 触发淹没分析，水位:', waterLevel, 'seq:', seq)

    // 并行请求淹没范围和统计数据
    const [floodAreasData, statisticsData] = await Promise.all([
      apiRequest(`/gcs/flood-areas?waterLevel=${waterLevel}`),
      apiRequest(`/gcs/flood-statistics?waterLevel=${waterLevel}`),
    ])

    logger.debug('[GCS] 淹没分析响应:', { floodAreasData, statisticsData })

    if (floodAreasData.code === 200 && statisticsData.code === 200) {
      // FIX:P2-02: 已有更新请求，丢弃过期响应
      if (seq !== analysisSeq) return
      // 如果当前路由不再是 3D，丢弃过期响应防止污染 2D 渲染器
      if (!shouldRenderForCurrentRoute()) return
      // FIX:P2-07: 实际档位与请求不一致时提示，��义透明
      if (
        floodAreasData.data.actualWaterLevel !== undefined &&
        floodAreasData.data.actualWaterLevel !== waterLevel
      ) {
        logger.info(
          `[GCS] 请求水位 ${waterLevel}m，实际使用数据档位 ${floodAreasData.data.actualWaterLevel}m`,
        )
      }
      const features = floodAreasData.data.features || []
      const statistics = statisticsData.data
      const riskLevel = floodAreasData.data.riskLevel || '无风险'

      logger.debug('[GCS] 更新淹没分析数据:', { statistics, features: features.length, riskLevel })

      floodStore.startFloodAnalysis(statistics, features, riskLevel)

      // 在地图上渲染淹没范围
      renderFloodAreas(features)
    } else {
      console.warn('[GCS] 淹没分析响应异常:', { floodAreasData, statisticsData })
    }
  } catch (error) {
    ElMessage.error('淹没分析失败，请检查网络连接')
    console.error('[GCS] 淹没分析失败:', error)
  }
}

async function triggerImpactAssessment(waterLevel, seq) {
  try {
    logger.debug('[GCS] 触发影响评估，水位:', waterLevel, 'seq:', seq)

    // 调用灾害评估接口
    const data = await apiRequest('/gcs/analysis/disaster', {
      method: 'POST',
      body: JSON.stringify({ waterLevel }),
    })
    logger.debug('[GCS] 影响评估响应:', data)

    if (data.code === 200) {
      // FIX:P2-02: 已有更新请求，丢弃过期响应
      if (seq !== analysisSeq) return
      // 如果当前路由不再是 3D，丢弃过期响应防止污染 2D 渲染器
      if (!shouldRenderForCurrentRoute()) return
      const result = data.data
      const facilities = result.affectedFacilities || []
      const totalLoss = result.totalLoss || 0

      logger.debug('[GCS] 更新影响评估数据:', { facilities: facilities.length, totalLoss })

      portImpactStore.setPortImpactResult(facilities, totalLoss)

      // 在地图上渲染受影响设施
      renderAffectedFacilities(facilities)
    } else {
      console.warn('[GCS] 影响评估响应异常:', data)
    }
  } catch (error) {
    ElMessage.error('影响评估失败，请检查网络连接')
    console.error('[GCS] 影响评估失败:', error)
  }
}

function renderFloodAreas(features) {
  if (!features || features.length === 0) return

  const riskLevel = floodStore.floodRiskLevel
  const fillColor = getRiskFillColor(riskLevel)
  const strokeColor = getRiskColor(riskLevel)

  const geojson = {
    type: 'FeatureCollection',
    features: features,
  }

  businessLayerManager.updateData(FLOOD_LAYER_ID, {
    data: geojson,
    options: {
      fillColor,
      strokeColor,
      strokeWidth: 2,
      featureType: 'flood-area',
    },
  })
}

function renderAffectedFacilities(facilities) {
  if (!facilities || facilities.length === 0) return

  const geojson = {
    type: 'FeatureCollection',
    features: facilities.map((f) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [f.longitude || 0, f.latitude || 0],
      },
      properties: {
        id: f.id,
        name: f.name,
        type: f.type,
        port: f.port,
        loss: f.loss,
        damageRate: f.damageRate,
      },
    })),
  }

  businessLayerManager.updateData(FACILITY_LAYER_ID, {
    data: geojson,
    options: {
      markerColor: '#F56C6C',
      markerSize: 10,
      featureType: 'facility-point',
    },
  })
}

function getRiskColor(riskLevel) {
  const colorMap = {
    无风险: '#909399',
    低风险: '#67C23A',
    中风险: '#E6A23C',
    高风险: '#F56C6C',
    极高风险: '#F56C6C',
    灾难级: '#F56C6C',
  }
  return colorMap[riskLevel] || '#909399'
}

function getRiskFillColor(riskLevel) {
  const colorMap = {
    无风险: 'rgba(144, 147, 153, 0.3)',
    低风险: 'rgba(103, 194, 58, 0.3)',
    中风险: 'rgba(230, 162, 60, 0.3)',
    高风险: 'rgba(245, 108, 108, 0.3)',
    极高风险: 'rgba(245, 108, 108, 0.4)',
    灾难级: 'rgba(245, 108, 108, 0.5)',
  }
  return colorMap[riskLevel] || 'rgba(144, 147, 153, 0.3)'
}

// 水位变化时更新水面高度
watch(
  () => waterLevelStore.waterLevel,
  (newLevel) => {
    if (!businessLayerManager.has(WATER_SURFACE_ID)) return
    businessLayerManager.updateData(WATER_SURFACE_ID, {
      data: { coordinates: cachedWaterAreaCoords || FALLBACK_WATER_AREA_COORDINATES, height: newLevel },
    })
  },
)

onUnmounted(() => {
  unmounted = true

  // 清除防抖分析定时器
  if (analysisTimer) {
    clearTimeout(analysisTimer)
    analysisTimer = null
  }

  // Manager 统一清理业务图层
  businessLayerManager.remove(WATER_SURFACE_ID)
  businessLayerManager.remove(FLOOD_LAYER_ID)
  businessLayerManager.remove(FACILITY_LAYER_ID)

  // 重置注册标志
  gcsLayersRegistered = false

  gcsStore.resetAll()
})
</script>

<template>
  <!-- FIX:P2-01: 类名与样式表统一 -->
  <div class="flood-analysis-page">
    <AppLayout>
      <template #left>
        <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <FloodAnalysisReportPanel />
        </GcsPanel>

        <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <AffectedFacilityListPanel />
        </GcsPanel>
      </template>

      <template #right>
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <WaterLevelProfilePanel />
        </GcsPanel>

        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel />
        </GcsPanel>
      </template>
    </AppLayout>
  </div>
</template>

<style scoped>
.flood-analysis-page {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  /* 让鼠标事件穿透到下层地图，面板通过 :deep(.gcs-panel) 恢复 */
  pointer-events: none;
}

/* 仅面板恢复鼠标事件 */
.flood-analysis-page :deep(.gcs-panel) {
  pointer-events: auto;
}

.panel-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px dashed rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.6);
}

.placeholder-title {
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 8px;
}

.placeholder-desc {
  font-size: 13px;
  opacity: 0.7;
}

/* Cesium 3D路由禁用backdrop-filter，避免WebGL性能问题 */
.flood-analysis-page :deep(.gcs-panel) {
  backdrop-filter: none !important;
  background: rgba(255, 255, 255, 0.95) !important;
}
</style>
