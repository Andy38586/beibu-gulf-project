<script setup lang="ts">
/**
 * 浸没分析模块：数据源经 floodAdapter（数据源适配层）隔离（Express api + FastAPI online 演算），
 * 业务图层经 BusinessLayerManager（BLM）独立注册/销毁；3D 渲染器不依赖 2D 引擎独立承载业务，
 * 相机（height<->zoom）2D/3D 切换同步。切换数据源仅改 adapter，业务代码零改动。
 */
import { nextTick, onMounted, onUnmounted, watch } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'

import { useBusinessLayers } from '@/core'
import AppLayout from '@/core/layout/AppLayout.vue'
import GCSPanel from '@/core/layout/components/GCSPanel.vue'
import LayerControlPanel from '@/core/map/components/LayerControlPanel.vue'
import { floodAdapter } from '@/services'
import { showError, showWarning, useLatestRequest } from '@/shared'
import { logger } from '@/shared'
import { useFloodStore } from '@/stores'
import { useMapStore } from '@/stores'
import type { AffectedFacility, FloodFeature, FloodStatistics } from '@/types/business/base'

import AffectedFacilityListPanel from './components/AffectedFacilityListPanel.vue'
import FloodAnalysisReportPanel from './components/FloodAnalysisReportPanel.vue'
import WaterLevelProfilePanel from './components/WaterLevelProfilePanel.vue'
import { FLOOD_RISK_COLORS, FLOOD_RISK_DEFAULT } from './constants/colors'

// waterLevel/portImpact/profile 三 store 已并入 floodStore，统一从此取
const floodStore = useFloodStore()
const mapStore = useMapStore()
const { manager: businessLayerManager } = useBusinessLayers()

const route = useRoute()

function shouldRenderForCurrentRoute() {
  const actual = mapStore.currentRenderer?.getType?.()
  if (!actual) return false
  // online 实时演算结果 2D/3D 均可渲染；仅 api/mock 静态档位模式保持 3D-only（防 2D 引擎污染 3D 渲染器）
  if (floodAdapter.dataSource === 'online') return true
  const expected = route.meta?.engine
  return expected === actual
}

/** 状态恢复标志：恢复状态时禁止 watch 触发重复 API 请求 */
let stateRestored = false

/** 防抖（debounce）定时器 */
let analysisTimer: ReturnType<typeof setTimeout> | null = null

/** 水面高度更新防抖定时器（独立于分析防抖，避免互相 clearTimeout 打断） */
let waterSurfaceTimer: ReturnType<typeof setTimeout> | null = null

// 请求序号，仅最新响应写 store；防止切回2D后数据污染渲染器
let analysisSeq = 0
let unmounted = false

// flood/impact 两路竞态守卫各持独立 useLatestRequest 实例（淹没分析与影响评估互不干扰）
const {
  createSignal: createFloodSignal,
  cancel: cancelFlood,
  getCurrentSignal: getFloodSignal,
} = useLatestRequest()
const { createSignal: createImpactSignal, cancel: cancelImpact } = useLatestRequest()

// 防抖 100ms：500ms 时滑块感知延迟约 70% 来自防抖等待；竞态由新请求 abort 旧请求 + 取消静默兜底
const ANALYSIS_DELAY = 100

const WATER_SURFACE_ID = 'flood-water-surface'

const FLOOD_LAYER_ID = 'flood-area'
const FACILITY_LAYER_ID = 'flood-facilities'
/** 真实地形（DEM 数字高程模型山体阴影）图层 ID——DEM 数据仅属洪涝分析，洪涝页独享此 key */
const DEM_HILLSHADE_LAYER_ID = 'dem-hillshade'

// 水域坐标经 floodAdapter 加载，按 dataSource（static/api）自动切换取数来源，业务代码零改动
let cachedWaterAreaCoords: [number, number][] | null = null

// 水域坐标加载失败时降级 null（仅水面图层跳过，其余图层照常）：原实现无 try/catch 会抛出未捕获
// rejection，现以 toast 告知且不阻塞其余图层；signal 支持卸载时取消在途请求
async function loadWaterAreaCoordinates(signal?: AbortSignal): Promise<[number, number][] | null> {
  if (cachedWaterAreaCoords) return cachedWaterAreaCoords
  try {
    cachedWaterAreaCoords = await floodAdapter.getWaterArea(signal)
    return cachedWaterAreaCoords
  } catch (error) {
    if (!signal?.aborted) {
      logger.warn('[FloodAnalysisPage] 水域坐标加载失败，水面图层跳过:', error)
      showWarning('水域数据加载失败，水面图层暂不可用（其余图层正常）')
    }
    return null
  }
}

/** 图层是否已注册（防止重复注册） */
let floodLayersRegistered = false

/** 移除 Cesium 独占图层（水面/DEM）入口：引擎切回 2D 时调用，复位注册标志 */
function removeCesiumOnlyLayers() {
  if (businessLayerManager.has(WATER_SURFACE_ID)) businessLayerManager.remove(WATER_SURFACE_ID)
  if (businessLayerManager.has(DEM_HILLSHADE_LAYER_ID))
    businessLayerManager.remove(DEM_HILLSHADE_LAYER_ID)
  floodLayersRegistered = false
}

// 首次 register 仅建 catalog 条目（数据未就绪不渲染），API 返回数据后由 updateData 渲染
async function registerFloodLayers(signal?: AbortSignal) {
  if (floodLayersRegistered) return

  const waterCoords = await loadWaterAreaCoordinates(signal)
  if (unmounted) return

  floodLayersRegistered = true

  // 坐标加载失败时跳过水面图层注册，避免空坐标渲染
  if (waterCoords) {
    try {
      businessLayerManager.register(WATER_SURFACE_ID, {
        label: '水面',
        layerType: 'waterSurface',
        data: { coordinates: waterCoords, height: floodStore.waterLevel },
        options: { color: 'rgba(64, 158, 255, 0.5)' },
        visible: true,
      })
    } catch (e) {
      // 单图层注册失败（如 Cesium viewer 复用未就绪）不中断后续注册，避免其余图层连带缺失
      logger.warn('[FloodAnalysisPage] 水面图层注册失败（已跳过该层）:', e)
    }
  }

  // 淹没范围/受影响设施图层默认不注册：滑块未操作时面板无开关、地图不渲染；
  // 首次操作滑块由 renderFloodAreas/renderAffectedFacilities 的 has() 兜底自动注册，之后固定显示

  // 真实地形图层（DEM 山影：3D 走 hillshade PNG 贴图回退；2D 不提供——Cesium 独占定义）。
  // 默认不显示：渲染器未就绪时注册会造成面板"开"而地图无渲染的状态不同步，默认关保证面板/地图一致
  try {
    businessLayerManager.register(DEM_HILLSHADE_LAYER_ID, {
      label: '真实地形',
      layerType: 'geotiff',
      data: '/static/dem/dem_hillshade.tif',
      options: { opacity: 0.7 },
      // 默认不显示（面板开关初始"关"）；3D 真地形（z 起伏）是地图基础能力独立常驻，不受此开关影响
      visible: false,
    })
  } catch (e) {
    // 单图层注册失败不中断（与水面同款容错）
    logger.warn('[FloodAnalysisPage] 真实地形图层注册失败（已跳过该层）:', e)
  }
}

// 渲染器就绪/引擎变化时维护业务图层：水面/DEM 为 Cesium 独占——3D 注册、2D 移除入口；
// 注册标志随引擎复位，2D→3D 切换后重新注册（不再一次性锁死）
watch(
  () => mapStore.currentRenderer,
  (renderer) => {
    if (renderer) {
      void nextTick(() => {
        if (renderer.getType?.() === '3d') {
          void registerFloodLayers(getFloodSignal())
        } else {
          removeCesiumOnlyLayers()
        }
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
    waterLevel: floodStore.waterLevel,
    floodStatistics: floodStore.floodStatistics,
    floodFeatures: floodStore.floodFeatures,
    floodRiskLevel: floodStore.floodRiskLevel,
    affectedFacilities: floodStore.affectedFacilities,
    totalLoss: floodStore.totalLoss,
  })
}

/** 挂载时恢复保存的状态 */
onMounted(async () => {
  const savedState = floodStore.consumeState()
  if (savedState) {
    // 清除 {immediate: true} watch 已排入的防抖分析，避免恢复后覆盖
    if (analysisTimer) {
      clearTimeout(analysisTimer)
      analysisTimer = null
    }

    stateRestored = true

    floodStore.setWaterLevel(savedState.waterLevel)

    if (savedState.floodStatistics) {
      floodStore.startFloodAnalysis(
        savedState.floodStatistics,
        savedState.floodFeatures,
        savedState.floodRiskLevel
      )
    }

    if (savedState.affectedFacilities) {
      floodStore.setPortImpactResult(savedState.affectedFacilities, savedState.totalLoss ?? 0)
    }

    // 等待图层注册完成
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

// 滑块联动设计：未操作滑块则不注册淹没/设施图层（面板无开关、地图不渲染）；
// 首次操作后自动注册并固定显示；刷新/离开路由回到默认
let sliderInteracted = false

// 水位变化防抖后自动触发淹没分析与影响评估；immediate 首屏（未操作滑块）跳过自动分析
watch(
  () => floodStore.waterLevel,
  (newLevel) => {
    if (stateRestored) return

    if (!sliderInteracted) {
      sliderInteracted = true
      logger.debug('[Flood] 首屏初始化水位，跳过自动分析（等待用户操作滑块触发）')
      return
    }

    if (analysisTimer) {
      clearTimeout(analysisTimer)
    }

    analysisTimer = setTimeout(() => {
      // 递增请求序号
      const seq = ++analysisSeq
      logger.debug('[Flood] 防抖结束，触发分析，水位:', newLevel, 'seq:', seq)
      void triggerFloodAnalysis(newLevel, seq)
      void triggerImpactAssessment(newLevel, seq)
    }, ANALYSIS_DELAY)
  },
  { immediate: true }
)

async function triggerFloodAnalysis(waterLevel: number, seq: number) {
  // 新请求优先——createFloodSignal 内部 abort 上一路在途请求
  const signal = createFloodSignal()

  try {
    logger.debug('[Flood] 触发淹没分析，水位:', waterLevel, 'seq:', seq)

    // 经 floodAdapter 获取淹没分析结果（数据源隔离，业务层零改动）
    const { features, statistics, riskLevel, actualWaterLevel } =
      await floodAdapter.getFloodAnalysis(waterLevel, { signal })

    logger.debug('[Flood] 淹没分析响应:', { features: features.length, statistics, riskLevel })

    // 已有更新请求，丢弃过期响应
    if (seq !== analysisSeq) return
    // 如果当前路由不再是 3D，丢弃过期响应防止污染 2D 渲染器
    if (!shouldRenderForCurrentRoute()) return
    // 页面已卸载则丢弃响应，防止离开后图层复活
    if (unmounted) return
    // 洪涝数据为档位制（6 档），档位回显由滑块/图表自然呈现，无需"无精确数据"提示
    logger.debug('[Flood] 档位回显:', { waterLevel, actualWaterLevel })

    logger.debug('[Flood] 更新淹没分析数据:', { statistics, features: features.length, riskLevel })

    floodStore.startFloodAnalysis(
      statistics as FloodStatistics,
      features as FloodFeature[],
      riskLevel
    )

    // 在地图上渲染淹没范围
    renderFloodAreas(features as FloodFeature[])
  } catch (error) {
    // 主动取消（新请求抢占/卸载）静默——showError 只兜 AbortError/已取消 ApiError，中间形态仍会弹错（对齐 useSiteAnalysisApi.ts:48）
    if (signal.aborted) return
    // 失败用 toast：滑块拖动即自动重试，"重试"按钮是伪需求；取消类错误已静默过滤
    showError(error, { fallback: '淹没分析失败，请检查网络连接' })
    logger.error('[Flood] 淹没分析失败:', error)
  }
}

async function triggerImpactAssessment(waterLevel: number, seq: number) {
  // 新请求优先——createImpactSignal 内部 abort 上一路在途请求
  const signal = createImpactSignal()

  try {
    logger.debug('[Flood] 触发影响评估，水位:', waterLevel, 'seq:', seq)

    // 经 floodAdapter 获取影响评估结果（数据源隔离）
    const { affectedFacilities, totalLoss } = await floodAdapter.getImpactAssessment(waterLevel, {
      signal,
    })

    logger.debug('[Flood] 影响评估响应:', { facilities: affectedFacilities.length, totalLoss })

    // 已有更新请求，丢弃过期响应
    if (seq !== analysisSeq) return
    // 如果当前路由不再是 3D，丢弃过期响应防止污染 2D 渲染器
    if (!shouldRenderForCurrentRoute()) return
    // 页面已卸载则丢弃响应，防止离开后图层复活
    if (unmounted) return

    logger.debug('[Flood] 更新影响评估数据:', { facilities: affectedFacilities.length, totalLoss })

    floodStore.setPortImpactResult(affectedFacilities as AffectedFacility[], totalLoss)

    // 在地图上渲染受影响设施
    renderAffectedFacilities(affectedFacilities as AffectedFacility[])
  } catch (error) {
    // 主动取消（新请求抢占/卸载）静默，同 triggerFloodAnalysis
    if (signal.aborted) return
    // 同淹没分析：失败后拖动即自动重试，toast 即可
    showError(error, { fallback: '影响评估失败，请检查网络连接' })
    logger.error('[Flood] 影响评估失败:', error)
  }
}

function renderFloodAreas(features: FloodFeature[]) {
  // 空数组也继续更新（清空图层）：水位回落至无淹没档位时，残留旧多边形会与当前水位不符
  if (!features) return

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
  // 空数组也继续更新（清空图层）：水位回落无设施被淹时，残留旧 POI 会误导（用户实测问题）
  if (!facilities) return

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

  // points 图层契约要求 data 为点数组：传 FeatureCollection 会被透传为点数组而报错，故映射为点数组
  const points = facilities.map((f) => ({
    lng: f.lng || 0,
    lat: f.lat || 0,
    id: f.id,
    name: f.name,
    type: f.type,
    port: f.port,
    loss: f.loss,
    damageRate: f.damageRate,
  }))

  businessLayerManager.updateData(FACILITY_LAYER_ID, {
    data: points,
    options: {
      markerColor: '#F56C6C',
      markerSize: 10,
      featureType: 'facility-point',
    },
  })
}

function getRiskColor(riskLevel: string) {
  return (FLOOD_RISK_COLORS[riskLevel] ?? FLOOD_RISK_DEFAULT).stroke
}

function getRiskFillColor(riskLevel: string) {
  return (FLOOD_RISK_COLORS[riskLevel] ?? FLOOD_RISK_DEFAULT).fill
}

// 水位变化防抖后更新水面高度（与 ANALYSIS_DELAY 同节奏），滑块拖动期间合并为一次几何更新
watch(
  () => floodStore.waterLevel,
  (newLevel) => {
    if (!businessLayerManager.has(WATER_SURFACE_ID)) return
    if (!cachedWaterAreaCoords) return
    if (waterSurfaceTimer) clearTimeout(waterSurfaceTimer)
    waterSurfaceTimer = setTimeout(() => {
      if (unmounted) return
      businessLayerManager.updateData(WATER_SURFACE_ID, {
        data: { coordinates: cachedWaterAreaCoords, height: newLevel },
      })
    }, ANALYSIS_DELAY)
  }
)

onUnmounted(() => {
  unmounted = true

  // 中止在途请求，避免迟到响应在图层移除后重新注册（孤儿复活）
  cancelFlood()
  cancelImpact()

  // 清除防抖分析定时器
  if (analysisTimer) {
    clearTimeout(analysisTimer)
    analysisTimer = null
  }
  if (waterSurfaceTimer) {
    clearTimeout(waterSurfaceTimer)
    waterSurfaceTimer = null
  }

  // Manager 统一清理业务图层
  businessLayerManager.remove(WATER_SURFACE_ID)
  businessLayerManager.remove(FLOOD_LAYER_ID)
  businessLayerManager.remove(FACILITY_LAYER_ID)
  businessLayerManager.remove(DEM_HILLSHADE_LAYER_ID)

  // 重置注册标志
  floodLayersRegistered = false

  // 清除 adapter 缓存
  floodAdapter.clearCache()
  cachedWaterAreaCoords = null

  // 卸载时仅复位子状态（水位/影响评估）——分析数据保留在 store 活状态，
  // 供"跳 /profile → 返回"时 consumeState 恢复（2026-08-11 修复：原同时调
  // resetFloodAnalysis() 清空分析数据，导致往返恢复失效）；
  // 离开非 /profile 路由由 onBeforeRouteLeave 的 clearState() 统一清空。
  floodStore.resetSubStates()
})
</script>

<template>
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
          <LayerControlPanel
            :layer-order="[
              'base-image',
              'base-vector',
              'boundary',
              'ports',
              'flood-water-surface',
              'flood-area',
              'flood-facilities',
              'dem-hillshade',
            ]"
          />
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
  background: rgb(255 255 255 / 5%);
  border: 1px dashed rgb(255 255 255 / 20%);
  border-radius: 8px;
  color: rgb(255 255 255 / 60%);
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
  background: var(--GCS-bg-panel-translucent) !important;
}
</style>
