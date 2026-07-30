<script setup lang="ts">
/**
 * 浸没分析模块
 *
 * 当前阶段：架构验证期，使用 mock DEM 数据跑通 3D 水面 Primitive + 高程过滤链路
 * 数据状态：src/mock/flood/ 为模拟高程数据
 * 待接入：真实 DEM 数据（毕业论文阶段通过自然资源局获取）
 *
 * 本模块验证目标：
 * 1. BusinessLayerManager 的 waterSurface adapter 能否独立注册/销毁
 * 2. 3D 渲染器（CesiumRenderer）在不依赖 2D 引擎时的纯 3D 业务承载能力
 * 3. Cesium Primitive API 动态构建水面几何体的能力
 * 4. 相机状态（height<->zoom）在 2D<->3D 切换时的同步机制
 * 5. Data Adapter 隔离：floodAdapter 是业务层与数据源的唯一接口
 *    - 架构验证阶段：dataSource='mock'，使用示意性数据
 *    - 生产阶段：floodAdapter.setDataSource('api')，业务代码零改动
 */
import { nextTick, onMounted, onUnmounted, watch } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'

import AppLayout from '@/core/layout/AppLayout.vue'
import GCSPanel from '@/core/layout/components/GCSPanel.vue'
import { useBusinessLayers } from '@/core/map/composables/useBusinessLayers'
import { floodAdapter } from '@/services/adapters/floodAdapter'
import LayerControlPanel from '@/shared/components/LayerControlPanel.vue'
import { showError } from '@/shared/utils/errorHandler'
import { logger } from '@/shared/utils/logger'
import { useFloodState } from '@/stores/floodState'
import { useFloodStore } from '@/stores/floodStore'
import { useMapStore } from '@/stores/mapStore'
import { usePortImpactStore } from '@/stores/portImpactStore'
import { useWaterLevelStore } from '@/stores/waterLevelStore'
import type { AffectedFacility, FloodFeature, FloodStatistics } from '@/types/business/base'

import AffectedFacilityListPanel from './components/AffectedFacilityListPanel.vue'
import FloodAnalysisReportPanel from './components/FloodAnalysisReportPanel.vue'
import WaterLevelProfilePanel from './components/WaterLevelProfilePanel.vue'

const floodResetStore = useFloodStore()
const waterLevelStore = useWaterLevelStore()
const floodStore = useFloodState()
const portImpactStore = usePortImpactStore()
const mapStore = useMapStore()
const { manager: businessLayerManager } = useBusinessLayers()

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
let analysisTimer: ReturnType<typeof setTimeout> | null = null

// 请求序号，仅最新响应写 store；防止切回2D后数据污染渲染器
let analysisSeq = 0
let unmounted = false

// 请求取消控制器
let floodAbortController: AbortController | null = null
let impactAbortController: AbortController | null = null

const ANALYSIS_DELAY = 500

const WATER_SURFACE_ID = 'flood-water-surface'

const FLOOD_LAYER_ID = 'flood-area'
const FACILITY_LAYER_ID = 'flood-facilities'

// 通过 floodAdapter 加载水域坐标（Mock 数据，架构验证阶段）
// 生产阶段仅需 floodAdapter.setDataSource('api')，此处代码无需修改
let cachedWaterAreaCoords: [number, number][] | null = null

async function loadWaterAreaCoordinates() {
  if (cachedWaterAreaCoords) return cachedWaterAreaCoords
  cachedWaterAreaCoords = await floodAdapter.getWaterArea()
  return cachedWaterAreaCoords
}

/** 图层是否已注册（防止重复注册） */
let floodLayersRegistered = false

// 注册业务图层到 BusinessLayerManager
// 首次 register 只建 catalog 条目，不渲染（数据尚未就绪）
// API 返回数据后通过 updateData 渲染
async function registerFloodLayers() {
  if (floodLayersRegistered) return

  const waterCoords = await loadWaterAreaCoordinates()
  if (unmounted) return

  floodLayersRegistered = true

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
        registerFloodLayers()
      })
    }
  },
  { immediate: true }
)

onBeforeRouteLeave((to) => {
  if (to.path === '/profile') {
    saveCurrentState()
  } else {
    floodStore.clearState()
  }
})

function saveCurrentState() {
  floodStore.saveState({
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
onMounted(async () => {
  const savedState = floodStore.consumeState()
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
        savedState.floodRiskLevel
      )
    }

    if (savedState.affectedFacilities) {
      portImpactStore.setPortImpactResult(savedState.affectedFacilities, savedState.totalLoss ?? 0)
    }

    // 等待图层��册完成
    await nextTick()

    // 主动渲染图层
    if (savedState.floodFeatures && savedState.floodFeatures.length > 0) {
      renderFloodAreas(savedState.floodFeatures)
    }
    if (savedState.affectedFacilities && savedState.affectedFacilities.length > 0) {
      renderAffectedFacilities(savedState.affectedFacilities)
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
      // 递增请求序号
      const seq = ++analysisSeq
      logger.debug('[Flood] 防抖结束，触发分析，水位:', newLevel, 'seq:', seq)
      triggerFloodAnalysis(newLevel, seq)
      triggerImpactAssessment(newLevel, seq)
    }, ANALYSIS_DELAY)
  },
  { immediate: true }
)

async function triggerFloodAnalysis(waterLevel: number, seq: number) {
  // 取消之前的请求
  if (floodAbortController) {
    floodAbortController.abort()
  }
  floodAbortController = new AbortController()
  const signal = floodAbortController.signal

  try {
    logger.debug('[Flood] 触发淹没分析，水位:', waterLevel, 'seq:', seq)

    // 通过 floodAdapter 获取淹没分析结果（Adapter 隔离数据源，业务层无需修改）
    const { features, statistics, riskLevel, actualWaterLevel } =
      await floodAdapter.getFloodAnalysis(waterLevel, { signal })

    logger.debug('[Flood] 淹没分析响应:', { features: features.length, statistics, riskLevel })

    // 已有更新请求，丢弃过期响应
    if (seq !== analysisSeq) return
    // 如果当前路由不再是 3D，丢弃过期响应防止污染 2D 渲染器
    if (!shouldRenderForCurrentRoute()) return
    // 实际档位与请求不一致时提示
    if (actualWaterLevel !== undefined && actualWaterLevel !== waterLevel) {
      logger.info(`[Flood] 请求水位 ${waterLevel}m，实际使用数据档位 ${actualWaterLevel}m`)
    }

    logger.debug('[Flood] 更新淹没分析数据:', { statistics, features: features.length, riskLevel })

    floodStore.startFloodAnalysis(
      statistics as FloodStatistics,
      features as FloodFeature[],
      riskLevel
    )

    // 在地图上渲染淹没范围
    renderFloodAreas(features as FloodFeature[])
  } catch (error) {
    showError(error, { fallback: '淹没分析失败，请检查网络连接' })
    logger.error('[Flood] 淹没分析失败:', error)
  }
}

async function triggerImpactAssessment(waterLevel: number, seq: number) {
  // 取消之前的请求
  if (impactAbortController) {
    impactAbortController.abort()
  }
  impactAbortController = new AbortController()
  const signal = impactAbortController.signal

  try {
    logger.debug('[Flood] 触发影响评估，水位:', waterLevel, 'seq:', seq)

    // 通过 floodAdapter 获取影响评估结果（Adapter 隔离数据源）
    const { affectedFacilities, totalLoss } = await floodAdapter.getImpactAssessment(waterLevel, {
      signal,
    })

    logger.debug('[Flood] 影响评估响应:', { facilities: affectedFacilities.length, totalLoss })

    // 已有更新请求，丢弃过期响应
    if (seq !== analysisSeq) return
    // 如果当前路由不再是 3D，丢弃过期响应防止污染 2D 渲染器
    if (!shouldRenderForCurrentRoute()) return

    logger.debug('[Flood] 更新影响评估数据:', { facilities: affectedFacilities.length, totalLoss })

    portImpactStore.setPortImpactResult(affectedFacilities as AffectedFacility[], totalLoss)

    // 在地图上渲染受影响设施
    renderAffectedFacilities(affectedFacilities as AffectedFacility[])
  } catch (error) {
    showError(error, { fallback: '影响评估失败，请检查网络连接' })
    logger.error('[Flood] 影响评估失败:', error)
  }
}

function renderFloodAreas(features: FloodFeature[]) {
  if (!features || features.length === 0) return

  // 检查图层是否已注册，若未注册则先注册
  if (!businessLayerManager.has(FLOOD_LAYER_ID)) {
    businessLayerManager.register(FLOOD_LAYER_ID, {
      label: '淹没范围',
      layerType: 'geojson',
      data: null,
      options: {},
      visible: true,
    })
  }

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

function renderAffectedFacilities(facilities: AffectedFacility[]) {
  if (!facilities || facilities.length === 0) return

  // 检查图层是否已注册，若未注册则先注册
  if (!businessLayerManager.has(FACILITY_LAYER_ID)) {
    businessLayerManager.register(FACILITY_LAYER_ID, {
      label: '受影响设施',
      layerType: 'points',
      data: null,
      options: {},
      visible: true,
    })
  }

  const geojson = {
    type: 'FeatureCollection',
    features: facilities.map((f) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [f.lng || 0, f.lat || 0],
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

function getRiskColor(riskLevel: string) {
  const colorMap: Record<string, string> = {
    无风险: '#909399',
    低风险: '#67C23A',
    中风险: '#E6A23C',
    高风险: '#F56C6C',
    极高风险: '#F56C6C',
    灾难级: '#F56C6C',
  }
  return colorMap[riskLevel] || '#909399'
}

function getRiskFillColor(riskLevel: string) {
  const colorMap: Record<string, string> = {
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
    if (!cachedWaterAreaCoords) return
    businessLayerManager.updateData(WATER_SURFACE_ID, {
      data: { coordinates: cachedWaterAreaCoords, height: newLevel },
    })
  }
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
  floodLayersRegistered = false

  // 清除 adapter 缓存
  floodAdapter.clearCache()
  cachedWaterAreaCoords = null

  floodResetStore.resetAll()
})
</script>

<template>
  <!-- 类名与样式表统一 -->
  <div class="flood-analysis-page">
    <AppLayout>
      <template #left>
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <FloodAnalysisReportPanel />
        </GCSPanel>

        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <AffectedFacilityListPanel />
        </GCSPanel>
      </template>

      <template #right>
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <WaterLevelProfilePanel />
        </GCSPanel>

        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel />
        </GCSPanel>
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
  pointer-events: none;
}

.flood-analysis-page :deep(.GCS-panel) {
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
.flood-analysis-page :deep(.GCS-panel) {
  backdrop-filter: none !important;
  background: rgba(255, 255, 255, 0.95) !important;
}
</style>
