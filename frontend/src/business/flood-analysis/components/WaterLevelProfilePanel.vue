<script setup lang="ts">
/**
 * WaterLevelProfilePanel - 水位滑块与剖面分析控制面板
 *
 * 功能：
 * 1. 水位滑块控制（0-10m，0.1步长）
 * 2. 可点击刻度标记（平均海平面/设计高潮位/极端最高水位）
 * 3. 下拉选择4条预设剖面线
 * 4. 自动显示ECharts高程剖面图
 * 5. 叠加当前水位线（随水位变化自动更新）
 *
 * 布局：4×4 Cell
 * 位置：右上（top-right）
 */

import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useWaterLevelStore } from '@/stores/waterLevelStore'
import { useProfileStore } from '@/stores/profileStore'
import { useGCS } from '@/core/layout/useGCS.js'
import { useApiRequest } from '@/shared/composables/useApiRequest'
import { showError } from '@/shared/utils/errorHandler'
import { logger } from '@/shared/utils/logger'
import * as echarts from 'echarts/core'
import type { EChartsType } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  TitleComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { PROFILE_COLORS } from '@/shared/constants/colors'

echarts.use([
  LineChart,
  GridComponent,
  TitleComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])

/** 剖面线数据结构（对应后端 terrainProfile.json） */
interface TerrainProfilePoint {
  distance: number
  lng: number
  lat: number
  elevation: number
}

interface TerrainProfile {
  id: string
  name: string
  port?: string
  description?: string
  points: TerrainProfilePoint[]
}

/** API 响应通用结构 */
interface ApiResponse<T> {
  code: number
  data: T
  message?: string
}

const { apiRequest } = useApiRequest()
const waterLevelStore = useWaterLevelStore()
const profileStore = useProfileStore()
// 直接从 useGCS 解构 CSS 变量供 v-bind() 使用
const { cell8px, cell16px } = useGCS()

const localWaterLevel = ref(waterLevelStore.waterLevel)

/**
 * 可点击刻度标记配置
 */
const scaleMarks = [
  { label: '平均海平面', value: 2.5 },
  { label: '设计高潮位', value: 4.5 },
  { label: '极端最高水位', value: 6.8 },
]

/**
 * 监听Store水位变化，同步到本地
 */
watch(
  () => waterLevelStore.waterLevel,
  (newLevel) => {
    localWaterLevel.value = newLevel
  }
)

/**
 * Slider值变化处理
 * 用户拖动Slider时触发，直接更新Store
 * 防抖由父组件FloodAnalysisPage统一处理（500ms）
 */
function onSliderChange(value) {
  waterLevelStore.setWaterLevel(value)
}

function setWaterLevelByMark(value) {
  localWaterLevel.value = value
  waterLevelStore.setWaterLevel(value)
}

/** 剖面线列表 */
const profiles = ref<TerrainProfile[]>([])

/** 当前选中的剖面线ID */
const selectedProfileId = ref<string | null>(null)

/** ECharts实例 */
let chartInstance: EChartsType | null = null

/** ECharts容器DOM引用 */
const chartContainerRef = ref<HTMLElement | null>(null)

/**
 * 加载剖面线数据
 * 从后端API获取所有预设剖面线
 */
async function loadProfiles() {
  try {
    const result = await apiRequest<ApiResponse<TerrainProfile[]>>('/gcs/terrain-profiles')

    if (result.code === 200 && result.data) {
      profiles.value = result.data
      // 默认选择第一条剖面线
      if (profiles.value.length > 0) {
        selectedProfileId.value = profiles.value[0].id
        profileStore.setSelectedProfile(profiles.value[0].id)
      }
    } else {
      showError('加载剖面线数据失败')
    }
  } catch (error) {
    logger.error('加载剖面线失败:', error)
    showError(error, { fallback: '加载剖面线数据失败' })
  }
}

/**
 * 获取当前选中的剖面数据
 */
function getCurrentProfile() {
  return profiles.value.find((p) => p.id === selectedProfileId.value)
}

/**
 * 初始化ECharts图表
 */
function initChart() {
  if (!chartContainerRef.value) return

  // 如果已有实例，先销毁
  if (chartInstance) {
    chartInstance.dispose()
  }

  chartInstance = echarts.init(chartContainerRef.value)
}

/**
 * 更新剖面图表
 */
function updateChart() {
  if (!chartInstance) {
    initChart()
  }
  if (!chartInstance) {
    return
  }

  const profile = getCurrentProfile()
  if (!profile) {
    return
  }

  // 提取距离和高程数据
  const distances = profile.points.map((p) => p.distance)
  const elevations = profile.points.map((p) => p.elevation)

  const waterLevel = waterLevelStore.waterLevel

  // 配置ECharts选项
  const option = {
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const distance = params[0].axisValue
        let content = `距离: ${distance}m<br/>`
        params.forEach((param) => {
          content += `${param.marker}${param.seriesName}: ${param.value}m<br/>`
        })
        return content
      },
    },
    legend: {
      data: ['地形高程', '水位线'],
      top: 0,
      textStyle: {
        fontSize: 12,
      },
    },
    grid: {
      left: '10%',
      right: '10%',
      bottom: '10%',
      top: '20%',
    },
    xAxis: {
      type: 'category',
      data: distances,
      name: '距离 (m)',
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: {
        fontSize: 12,
      },
    },
    yAxis: {
      type: 'value',
      name: '高程 (m)',
      nameTextStyle: {
        fontSize: 12,
      },
    },
    series: [
      {
        name: '地形高程',
        type: 'line',
        data: elevations,
        smooth: true,
        lineStyle: {
          color: PROFILE_COLORS.safe,
          width: 2,
        },
        itemStyle: {
          color: PROFILE_COLORS.safe,
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(103, 194, 58, 0.3)' },
            { offset: 1, color: 'rgba(103, 194, 58, 0.05)' },
          ]),
        },
      },
      {
        name: '水位线',
        type: 'line',
        data: distances.map(() => waterLevel),
        lineStyle: {
          color: PROFILE_COLORS.water,
          width: 2,
          type: 'dashed',
        },
        itemStyle: {
          color: PROFILE_COLORS.water,
        },
        symbol: 'none',
      },
    ],
  }

  // 使用增量更新模式：notMerge=false 保留现有配置，lazyUpdate=true 延迟渲染提升性能
  chartInstance.setOption(option, { notMerge: false, lazyUpdate: true })
}

/**
 * 监听剖面线选择变化
 */
watch(selectedProfileId, (newId) => {
  profileStore.setSelectedProfile(newId)
  updateChart()
})

/**
 * 监听水位变化，更新图表中的水位线
 */
watch(
  () => waterLevelStore.waterLevel,
  () => {
    if (chartInstance && selectedProfileId.value) {
      updateChart()
    }
  }
)

/**
 * 组件挂载时初始化
 */
onMounted(() => {
  loadProfiles()
  initChart()

  // 监听窗口大小变化
  window.addEventListener('resize', handleResize)
})

/**
 * 处理窗口大小变化
 */
function handleResize() {
  if (chartInstance) {
    chartInstance.resize()
  }
}

/**
 * 组件卸载时清理
 */
onUnmounted(() => {
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }

  window.removeEventListener('resize', handleResize)
})
</script>

<template>
  <div class="water-level-profile-panel">
    <!-- 标题区 -->
    <div class="panel-header">
      <div class="header-title">剖面分析</div>
      <ElSelect
        v-model="selectedProfileId"
        placeholder="选择剖面线"
        size="small"
        class="profile-select"
        :teleported="false"
      >
        <ElOption
          v-for="profile in profiles"
          :key="profile.id"
          :label="profile.name"
          :value="profile.id"
        />
      </ElSelect>
    </div>

    <!-- ECharts图表区 -->
    <div ref="chartContainerRef" class="chart-container"></div>

    <!-- 水位滑块区域（紧凑布局） -->
    <div class="water-slider-container">
      <ElSlider
        v-model="localWaterLevel"
        :min="0"
        :max="10"
        :step="0.1"
        :show-tooltip="false"
        @input="onSliderChange"
        @change="onSliderChange"
      />
      <div class="scale-marks">
        <span
          v-for="mark in scaleMarks"
          :key="mark.value"
          class="scale-mark clickable"
          @click="setWaterLevelByMark(mark.value)"
        >
          {{ mark.label }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.water-level-profile-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: v-bind(cell16px);
  gap: 12px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 8px;
  box-sizing: border-box;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--gcs-text-primary);
}

.profile-select {
  width: 160px;
}

.control-section {
  display: flex;
  flex-direction: column;
  gap: v-bind(cell8px);
}

.control-label {
  font-size: 13px;
  color: var(--gcs-text-secondary);
}

.action-buttons {
  display: flex;
  gap: v-bind(cell8px);
}

.action-buttons .el-button {
  flex: 1;
  font-size: 12px;
}

.chart-container {
  flex: 1;
  min-height: 0;
  width: 100%;
}

/* 水位滑块区域（紧凑布局） */
.water-slider-container {
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
}

.scale-marks {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--gcs-text-muted);
  padding: 2px 0;
}

.scale-mark {
  cursor: pointer;
  transition: color 0.2s;
}

.scale-mark.clickable {
  color: var(--gcs-color-primary);
  font-weight: 500;
}

.scale-mark.clickable:hover {
  color: var(--gcs-color-primary-hover);
  text-decoration: underline;
}
</style>
