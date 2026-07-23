<script setup>
/**
 * FloodAnalysisPage - 浸没分析页面
 *
 * 职责：
 * 1. 继承Home Layout（AppLayout）
 * 2. 使用Cesium引擎（由App.vue根据route.meta.engine='3d'自动切换）
 * 3. 为业务模块提供面板容器
 * 4. 管理GCS状态生命周期
 * 5. 自动响应水位变化，实时更新分析报告和设施清单
 *
 * 布局结构（4面板，4×4 Cell）：
 * - 左上：浸没分析报告（合并港口影响+风险分析）
 * - 左下：受影响设施清单（分页显示）
 * - 右上：剖面分析面板
 * - 右下：水位动态模拟（整合滑块控制）
 *
 * 架构说明：
 * - UnifiedMap已在App.vue根级别挂载，无需重复引入
 * - 引擎切换由App.vue监听route.meta.engine自动处理
 * - Cesium实例由CesiumViewerManager单例缓存，离开路由不销毁
 * - AppLayout提供布局基座，业务路由仅替换slot内容
 */

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
import { useLayerManager } from '@/core/map/composables/useLayerManager'
import { useApiRequest } from '@/shared/composables/useApiRequest'
import WaterLevelProfilePanel from './components/WaterLevelProfilePanel.vue'
import FloodAnalysisReportPanel from './components/FloodAnalysisReportPanel.vue'
import AffectedFacilityListPanel from './components/AffectedFacilityListPanel.vue'
import LayerControlPanel from '@/shared/components/LayerControlPanel.vue'

const { apiRequest } = useApiRequest()
const gcsStore = useGcsStore()
const waterLevelStore = useWaterLevelStore()
const floodStore = useFloodStore()
const portImpactStore = usePortImpactStore()
const mapStore = useMapStore()
const { layerCatalog, registerToggleable } = useLayerManager()

const floodStateStore = useFloodStateStore()

const route = useRoute()

/** 路由切换守卫：响应到达时校验当前路由是否仍为 3D，防止切回 2D 后过期数据污染渲染器 */
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

// BUGFIX-P2-02: 请求序号，仅最新一代响应允许写 store
let analysisSeq = 0

// BUGFIX: 组件卸载标记，阻止 registerGcsLayers 中 await 后的操作
let unmounted = false

/** 防抖延迟（毫秒） */
const ANALYSIS_DELAY = 500

/**
 * 水面图层ID
 * 用于标识和管理水面Entity
 */
const WATER_SURFACE_ID = 'main-water-surface'

/** 淹没范围图层ID（与目录 key 一致，使 setVisibility 能查到 _layers） */
const FLOOD_LAYER_ID = 'gcs-flood-area'

/** 受影响设施图层ID（与目录 key 一致） */
const FACILITY_LAYER_ID = 'gcs-facilities'

/**
 * 示例水面区域坐标（钦州港附近海域）
 * 实际项目中应该从floodArea.json加载
 */
// BUGFIX-P3-02: 水面坐标从 public/data/water-area.json 加���，硬编码仅作兜底
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
    const res = await fetch('/data/water-area.json')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    cachedWaterAreaCoords = data.coordinates
    return cachedWaterAreaCoords
  } catch {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[GCS] water-area.json 加载失败，使用兜底坐标')
    }
    return FALLBACK_WATER_AREA_COORDINATES
  }
}

/** 图层是否已注册（防止重复注册） */
let gcsLayersRegistered = false

/**
 * 注册浸没分析图层到图层控制面板
 *
 * 关键设计（与选址分析一致）：
 * registerToggleable(key, label, renderer) → store 生成的 show/hide 回调为
 *   renderer.setVisibility(key, true/false)
 * 即使 layer 尚未 add 到 Cesium，setVisibility 会存入 _pendingVisibility，
 * 后续 addGeoJsonLayer 时自动应用可见性
 */
async function registerGcsLayers() {
  if (gcsLayersRegistered) {
    return
  }

  const renderer = mapStore.currentRenderer
  if (!renderer) {
    return
  }

  // BUGFIX-P3-02: 先加载水面坐标，再设注册标志（防止 await 期间卸载导致竞态）
  const waterCoords = await loadWaterAreaCoordinates()
  if (unmounted) return

  gcsLayersRegistered = true

  // 注册水面图层（默认开启）
  registerToggleable(
    'gcs-water-surface',
    '水面',
    () => {
      renderer.addWaterSurface(WATER_SURFACE_ID, waterCoords, waterLevelStore.waterLevel, {
        color: 'rgba(64, 158, 255, 0.5)',
      })
    },
    () => {
      renderer.removeWaterSurface(WATER_SURFACE_ID)
    },
    true,
  )

  // 淹没范围：传 renderer，store 自建 setVisibility 回调（与选址分析一致）
  registerToggleable('gcs-flood-area', '淹没范围', renderer, undefined, true)

  // 受影响设施：传 renderer，同上
  registerToggleable('gcs-facilities', '受影响设施', renderer, undefined, true)
}

/**
 * 监听渲染器就绪，注册浸没分析图层
 * 渲染器就绪时自动注册图层到控制面板
 */
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

/**
 * 路由守卫：跳转到个人中心时保存状态
 */
onBeforeRouteLeave((to) => {
  if (to.path === '/profile') {
    saveCurrentState()
  } else {
    floodStateStore.clearState()
  }
})

/**
 * 保存当前浸没分析状态
 */
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
      portImpactStore.setPortImpactResult(
        savedState.affectedFacilities,
        savedState.totalLoss,
      )
    }

    stateRestored = false
  }
})

/**
 * 监听水位变化，自动触发淹没分析和影响评估
 * 使用防抖（0.5秒）避免频繁调用
 * immediate: true 确保进入路由时立即触发一次分析
 */
watch(
  () => waterLevelStore.waterLevel,
  (newLevel) => {
    if (stateRestored) return

    if (analysisTimer) {
      clearTimeout(analysisTimer)
    }

    analysisTimer = setTimeout(() => {
      // BUGFIX-P2-02: 递增请求序号
      const seq = ++analysisSeq
      console.log('[GCS] 防抖结束，触发分析，水位:', newLevel, 'seq:', seq)
      triggerFloodAnalysis(newLevel, seq)
      triggerImpactAssessment(newLevel, seq)
    }, ANALYSIS_DELAY)
  },
  { immediate: true },
)

/**
 * 触发淹没分析
 * @param {number} waterLevel - 当前水位
 */
async function triggerFloodAnalysis(waterLevel, seq) {
  try {
    console.log('[GCS] 触发淹没分析，水位:', waterLevel, 'seq:', seq)

    // 并行请求淹没范围和统计数据
    const [floodAreasData, statisticsData] = await Promise.all([
      apiRequest(`/gcs/flood-areas?waterLevel=${waterLevel}`),
      apiRequest(`/gcs/flood-statistics?waterLevel=${waterLevel}`),
    ])

    console.log('[GCS] 淹没分析响应:', { floodAreasData, statisticsData })

    if (floodAreasData.code === 200 && statisticsData.code === 200) {
      // BUGFIX-P2-02: 已有更新请求，丢弃过期响应
      if (seq !== analysisSeq) return
      // 如果当前路由不再是 3D，丢弃过期响应防止污染 2D 渲染器
      if (!shouldRenderForCurrentRoute()) return
      // BUGFIX-P2-07: 实际档位与请求不一致时提示，��义透明
      if (floodAreasData.data.actualWaterLevel !== undefined && floodAreasData.data.actualWaterLevel !== waterLevel) {
        console.info(`[GCS] 请求水位 ${waterLevel}m，实际使用数据档位 ${floodAreasData.data.actualWaterLevel}m`)
      }
      const features = floodAreasData.data.features || []
      const statistics = statisticsData.data
      const riskLevel = floodAreasData.data.riskLevel || '无风险'

      console.log('[GCS] 更新淹没分析数据:', { statistics, features: features.length, riskLevel })

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

/**
 * 触发影响评估
 * @param {number} waterLevel - 当前水位
 */
async function triggerImpactAssessment(waterLevel, seq) {
  try {
    console.log('[GCS] 触发影响评估，水位:', waterLevel, 'seq:', seq)

    // 调用灾害评估接口
    const data = await apiRequest('/gcs/analysis/disaster', {
      method: 'POST',
      body: JSON.stringify({ waterLevel }),
    })
    console.log('[GCS] 影响评估响应:', data)

    if (data.code === 200) {
      // BUGFIX-P2-02: 已有更新请求，丢弃过期响应
      if (seq !== analysisSeq) return
      // 如果当前路由不再是 3D，丢弃过期响应防止污染 2D 渲染器
      if (!shouldRenderForCurrentRoute()) return
      const result = data.data
      const facilities = result.affectedFacilities || []
      const totalLoss = result.totalLoss || 0

      console.log('[GCS] 更新影响评估数据:', { facilities: facilities.length, totalLoss })

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

/**
 * 在地图上渲染淹没范围多边形
 * @param {Array} features - GeoJSON特征数组
 */
function renderFloodAreas(features) {
  let renderer = mapStore.currentRenderer
  console.log('[DIAG] renderFloodAreas called', { 'renderer?': !!renderer, 'rendererType': renderer?.getType?.(), 'features.len': features?.length })
  if (!renderer) {
    // 渲染器尚未就绪，100ms 后重试，最多 10 次（≈1s 窗口）
    const start = Date.now()
    const retry = setInterval(() => {
      renderer = mapStore.currentRenderer
      if (renderer) {
        clearInterval(retry)
        doRenderFloodAreas(renderer, features)
      } else if (Date.now() - start > 10000) {
        clearInterval(retry)
        console.warn('[DIAG] renderFloodAreas: 等待渲染器超时，放弃本次渲染')
      }
    }, 100)
    return
  }
  doRenderFloodAreas(renderer, features)
}

function doRenderFloodAreas(renderer, features) {

  // 先移除旧的淹没范围图层
  renderer.removeLayer(FLOOD_LAYER_ID)

  if (!features || features.length === 0) {
    return
  }

  // 构建 GeoJSON 对象
  const geojson = {
    type: 'FeatureCollection',
    features: features,
  }

  // 根据风险等级确定颜色
  const riskLevel = floodStore.floodRiskLevel
  const fillColor = getRiskFillColor(riskLevel)
  const strokeColor = getRiskColor(riskLevel)

  // 添加淹没范围图层
  renderer.addGeoJsonLayer(FLOOD_LAYER_ID, geojson, {
    fillColor: fillColor,
    strokeColor: strokeColor,
    strokeWidth: 2,
    featureType: 'flood-area',
  })
}

/**
 * 在地图上渲染受影响设施点
 * @param {Array} facilities - 受影响设施列表
 */
function renderAffectedFacilities(facilities) {
  let renderer = mapStore.currentRenderer
  if (!renderer) {
    // 渲染器尚未就绪，100ms 后重试
    const start = Date.now()
    const retry = setInterval(() => {
      renderer = mapStore.currentRenderer
      if (renderer) {
        clearInterval(retry)
        doRenderAffectedFacilities(renderer, facilities)
      } else if (Date.now() - start > 10000) {
        clearInterval(retry)
        console.warn('[DIAG] renderAffectedFacilities: 等待渲染器超时')
      }
    }, 100)
    return
  }
  doRenderAffectedFacilities(renderer, facilities)
}

function doRenderAffectedFacilities(renderer, facilities) {

  // 先移除旧图层
  renderer.removeLayer(FACILITY_LAYER_ID)

  if (!facilities || facilities.length === 0) {
    return
  }

  // 构建 GeoJSON 点要素集合
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

  // 添加设施点图层（使用红色标记）
  renderer.addGeoJsonLayer(FACILITY_LAYER_ID, geojson, {
    markerColor: '#F56C6C',
    markerSize: 10,
    featureType: 'facility-point',
  })
}

/**
 * 获取风险等级对应的颜色
 * @param {string} riskLevel - 风险等级
 * @returns {string} 颜色值
 */
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

/**
 * 获取风险等级对应的填充颜色（半透明）
 * @param {string} riskLevel - 风险等级
 * @returns {string} 颜色值
 */
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

/**
 * 监听水位变化，更新水面高度
 * 使用节流避免频繁渲染
 */
watch(
  () => waterLevelStore.waterLevel,
  (newLevel) => {
    const renderer = mapStore.currentRenderer
    if (!renderer) {
      return
    }

    renderer.updateWaterLevel(WATER_SURFACE_ID, newLevel)
  },
)

/**
 * 组件卸载时重置GCS状态
 * 确保离开三维分析页面后清理所有分析数据
 */
onUnmounted(() => {
  unmounted = true

  // 清除防抖分析定时器，避免卸载后残留触发
  if (analysisTimer) {
    clearTimeout(analysisTimer)
    analysisTimer = null
  }

  // 移除水面
  const renderer = mapStore.currentRenderer
  if (renderer) {
    renderer.removeWaterSurface(WATER_SURFACE_ID)
  }

  // 从 LayerControlPanel 移除已注册的三个图层
  mapStore.removeLayer('gcs-water-surface')
  mapStore.removeLayer('gcs-flood-area')
  mapStore.removeLayer('gcs-facilities')

  // 重置图层注册标志
  gcsLayersRegistered = false

  gcsStore.resetAll()
})
</script>

<template>
  <!-- BUGFIX-P2-01: 类名与样式表统一为 flood-analysis-page -->
  <div class="flood-analysis-page">
    <!-- 继承Home Layout，仅替换左右slot内容 -->
    <AppLayout>
      <!-- 左侧面板组 -->
      <template #left>
        <!-- 左上：浸没分析报告 -->
        <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <FloodAnalysisReportPanel />
        </GcsPanel>

        <!-- 左下：受影响设施清单 -->
        <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <AffectedFacilityListPanel />
        </GcsPanel>
      </template>

      <!-- 右侧面板组 -->
      <template #right>
        <!-- 右上：剖面分析面板（包含水位滑块） -->
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <WaterLevelProfilePanel />
        </GcsPanel>

        <!-- 右下：通用图层控制面板 -->
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
  /* 关键：让鼠标事件穿透到下层地图容器 */
  pointer-events: none;
}

/* 注意：不能使用 :deep(*) 通配符设置 pointer-events: none */
/* 原因：Vue scoped 样式中 :deep(*) 的选择器特异性(0,2,0)高于 */
/* UnifiedMap 的 .map-container(0,1,0)，会覆盖地图容器的 pointer-events: auto */
/* 导致 Cesium canvas 无法接收鼠标事件（拖拽/缩放/旋转全部失效） */
/* 正确做法：.flood-analysis-page 自身 pointer-events: none 即可穿透事件 */
/* 面板通过 :deep(.gcs-panel) 恢复 pointer-events: auto */

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
