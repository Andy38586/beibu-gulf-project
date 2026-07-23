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

import { onUnmounted, watch, nextTick } from 'vue'
import AppLayout from '@/core/layout/AppLayout.vue'
import GcsPanel from '@/core/layout/components/GcsPanel.vue'
import { useGcsStore } from '@/stores/gcsStore'
import { useMapStore } from '@/stores/map'
import { useLayerManager } from '@/core/map/composables/useLayerManager'
import WaterLevelProfilePanel from './components/WaterLevelProfilePanel.vue'
import FloodAnalysisReportPanel from './components/FloodAnalysisReportPanel.vue'
import AffectedFacilityListPanel from './components/AffectedFacilityListPanel.vue'
import LayerControlPanel from '@/shared/components/LayerControlPanel.vue'

const gcsStore = useGcsStore()
const mapStore = useMapStore()
const { layerCatalog, registerToggleableWithVisibility } = useLayerManager()

/** 防抖定时器 */
let analysisTimer = null

/** 防抖延迟（毫秒） */
const ANALYSIS_DELAY = 500

/**
 * 水面图层ID
 * 用于标识和管理水面Entity
 */
const WATER_SURFACE_ID = 'main-water-surface'

/** 淹没范围图层ID */
const FLOOD_LAYER_ID = 'flood-risk-area'

/** 受影响设施图层ID */
const FACILITY_LAYER_ID = 'port-impact-facilities'

/**
 * 示例水面区域坐标（钦州港附近海域）
 * 实际项目中应该从floodArea.json加载
 */
const WATER_AREA_COORDINATES = [
  [108.615, 21.855],
  [108.62, 21.855],
  [108.622, 21.858],
  [108.621, 21.862],
  [108.618, 21.863],
  [108.614, 21.861],
  [108.615, 21.855],
]

/** 图层是否已注册（防止重复注册） */
let gcsLayersRegistered = false

/**
 * 注册浸没分析图层到图层控制面板
 * 进入路由时调用，将水面、淹没范围、受影响设施注册为可切换图层
 */
function registerGcsLayers() {
  if (gcsLayersRegistered) {
    console.log('[GCS] 图层已注册，跳过')
    return
  }

  const renderer = mapStore.currentRenderer?.value
  if (!renderer) {
    console.warn('[GCS] registerGcsLayers: 渲染器未就绪')
    return
  }

  gcsLayersRegistered = true
  console.log('[GCS] 开始注册浸没分析图层到图层控制面板')

  // 注册水面图层（默认开启）
  registerToggleableWithVisibility(
    'gcs-water-surface',
    '水面',
    () => {
      renderer.addWaterSurface(WATER_SURFACE_ID, WATER_AREA_COORDINATES, gcsStore.waterLevel, {
        color: 'rgba(64, 158, 255, 0.5)',
      })
    },
    () => {
      renderer.removeWaterSurface(WATER_SURFACE_ID)
    },
    true,
  )

  // 注册淹没范围图层（默认关闭，分析后自动显示）
  registerToggleableWithVisibility(
    'gcs-flood-area',
    '淹没范围',
    () => {
      const features = gcsStore.floodFeatures
      if (features && features.length > 0) {
        renderFloodAreas(features)
      }
    },
    () => {
      renderer.removeLayer(FLOOD_LAYER_ID)
    },
    false,
  )

  // 注册受影响设施图层（默认关闭，分析后自动显示）
  registerToggleableWithVisibility(
    'gcs-facilities',
    '受影响设施',
    () => {
      const facilities = gcsStore.affectedFacilities
      if (facilities && facilities.length > 0) {
        renderAffectedFacilities(facilities)
      }
    },
    () => {
      renderer.removeLayer(FACILITY_LAYER_ID)
    },
    false,
  )
}

/**
 * 监听渲染器就绪，注册浸没分析图层
 * 渲染器就绪时自动注册图层到控制面板
 */
watch(
  () => mapStore.currentRenderer?.value,
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
 * 监听水位变化，自动触发淹没分析和影响评估
 * 使用防抖（0.5秒）避免频繁调用
 * immediate: true 确保进入路由时立即触发一次分析
 */
watch(
  () => gcsStore.waterLevel,
  (newLevel) => {
    // 清除之前的定时器
    if (analysisTimer) {
      clearTimeout(analysisTimer)
    }

    // 设置新的防抖定时器
    analysisTimer = setTimeout(() => {
      console.log('[GCS] 防抖结束，触发分析，水位:', newLevel)
      // 自动触发淹没分析
      triggerFloodAnalysis(newLevel)
      // 自动触发影响评估
      triggerImpactAssessment(newLevel)
    }, ANALYSIS_DELAY)
  },
  { immediate: true },
)

/**
 * 触发淹没分析
 * @param {number} waterLevel - 当前水位
 */
async function triggerFloodAnalysis(waterLevel) {
  try {
    console.log('[GCS] 触发淹没分析，水位:', waterLevel)

    // 并行请求淹没范围和统计数据
    const [floodAreasRes, statisticsRes] = await Promise.all([
      fetch(`/api/gcs/flood-areas?waterLevel=${waterLevel}`),
      fetch(`/api/gcs/flood-statistics?waterLevel=${waterLevel}`),
    ])

    const floodAreasData = await floodAreasRes.json()
    const statisticsData = await statisticsRes.json()

    console.log('[GCS] 淹没分析响应:', { floodAreasData, statisticsData })

    if (floodAreasData.code === 200 && statisticsData.code === 200) {
      const features = floodAreasData.data.features || []
      const statistics = statisticsData.data
      const riskLevel = floodAreasData.data.riskLevel || '无风险'

      console.log('[GCS] 更新淹没分析数据:', { statistics, features: features.length, riskLevel })

      // 更新 Store
      gcsStore.startFloodAnalysis(statistics, features, riskLevel)

      // 在地图上渲染淹没范围
      renderFloodAreas(features)
    } else {
      console.warn('[GCS] 淹没分析响应异常:', { floodAreasData, statisticsData })
    }
  } catch (error) {
    console.error('[GCS] 淹没分析失败:', error)
  }
}

/**
 * 触发影响评估
 * @param {number} waterLevel - 当前水位
 */
async function triggerImpactAssessment(waterLevel) {
  try {
    console.log('[GCS] 触发影响评估，水位:', waterLevel)

    // 调用灾害评估接口
    const res = await fetch('/api/gcs/analysis/disaster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waterLevel }),
    })

    const data = await res.json()
    console.log('[GCS] 影响评估响应:', data)

    if (data.code === 200) {
      const result = data.data
      const facilities = result.affectedFacilities || []
      const totalLoss = result.totalLoss || 0

      console.log('[GCS] 更新影响评估数据:', { facilities: facilities.length, totalLoss })

      // 更新 Store
      gcsStore.setPortImpactResult(facilities, totalLoss)

      // 在地图上渲染受影响设施
      renderAffectedFacilities(facilities)
    } else {
      console.warn('[GCS] 影响评估响应异常:', data)
    }
  } catch (error) {
    console.error('[GCS] 影响评估失败:', error)
  }
}

/**
 * 在地图上渲染淹没范围多边形
 * @param {Array} features - GeoJSON特征数组
 */
function renderFloodAreas(features) {
  const renderer = mapStore.currentRenderer?.value
  if (!renderer) {
    return
  }

  const FLOOD_LAYER_ID = 'flood-risk-area'

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
  const riskLevel = gcsStore.floodRiskLevel
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
  const renderer = mapStore.currentRenderer?.value
  if (!renderer) {
    return
  }

  const FACILITY_LAYER_ID = 'port-impact-facilities'

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
  () => gcsStore.waterLevel,
  (newLevel) => {
    const renderer = mapStore.currentRenderer?.value
    if (!renderer) {
      return
    }

    // 更新水面高度
    renderer.updateWaterLevel(WATER_SURFACE_ID, newLevel)
  },
)

/**
 * 组件卸载时重置GCS状态
 * 确保离开三维分析页面后清理所有分析数据
 */
onUnmounted(() => {
  // 移除水面
  const renderer = mapStore.currentRenderer?.value
  if (renderer) {
    renderer.removeWaterSurface(WATER_SURFACE_ID)
  }

  gcsStore.resetAll()
})
</script>

<template>
  <div class="gcs-analysis-page">
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
