<script setup lang="ts">
/**
 * 水位滑块与剖面分析面板：滑块控制水位（0-15m）、点击刻度标记、下拉选择预设剖面线，
 * 自动显示高程剖面图并叠加当前水位线。布局 4×4，右上角。
 */

import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import type { EChartsType } from 'echarts/core'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { useSliderFocus } from '@/core/layout/useSliderFocus'
import { useApiRequest } from '@/shared'
import { PROFILE_COLORS } from '@/shared'
import { useGCS } from '@/shared'
import { showError } from '@/shared'
import { logger } from '@/shared'
import { perfTimeFn } from '@/shared'
import { useFloodStore } from '@/stores'
import { terrainProfileSchema } from '@/types/schemas'

/** ECharts tooltip formatter 参数（axis 触发时为数组）：用本地最小接口替代 any，避免脆弱的深路径类型导入 */
interface TooltipFormatterParam {
  axisValue?: string | number
  marker?: string
  seriesName?: string
  value?: unknown
}

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

const { apiRequest } = useApiRequest()
const floodStore = useFloodStore()
// 滑块专注模式（安卓控制中心风格）：拖动水位滑块时隐藏其他面板，只留本面板
const { beginSliderFocus, endSliderFocus } = useSliderFocus()
// 直接从 useGCS 解构 CSS 变量供 v-bind() 使用
const { cell8px, cell16px } = useGCS()

const localWaterLevel = ref(floodStore.waterLevel)

/**
 * 可点击刻度标记（洪水口径，基于 DEM 数字高程模型实测高程与连通性淹没实测）：
 * 15m 进全部港口、20m 进全部城市+港口；滑块 0-15m（后端数据档位 0/2/5/8/10/15），
 * 刻度取 2/10/15 落在真实数据档位（港口进水即滑块尽头）
 */
const scaleMarks = [
  { label: '海平面', value: 0 },
  { label: '滩涂淹没', value: 2 },
  { label: '港口进水', value: 10 },
  { label: '全面淹没', value: 15 },
]

/** 水位变化时同步到本地滑块值 */
watch(
  () => floodStore.waterLevel,
  (newLevel) => {
    localWaterLevel.value = newLevel
  }
)

/** 滑块变化直接写 store；防抖由父组件统一处理 */
function onSliderChange(value: number | number[]) {
  const level = Array.isArray(value) ? value[0] : value
  floodStore.setWaterLevel(level)
}

function setWaterLevelByMark(value: number) {
  localWaterLevel.value = value
  floodStore.setWaterLevel(value)
}

/** 剖面线列表 */
const profiles = ref<TerrainProfile[]>([])

/** 当前选中的剖面线ID */
const selectedProfileId = ref<string | null>(null)

/** ECharts实例 */
let chartInstance: EChartsType | null = null

/** ECharts容器DOM引用 */
const chartContainerRef = ref<HTMLElement | null>(null)

/** 从后端加载全部预设剖面线 */
async function loadProfiles() {
  try {
    const result = await apiRequest<TerrainProfile[]>('/flood/terrain-profiles', {
      schema: terrainProfileSchema,
    })

    if (result && Array.isArray(result)) {
      profiles.value = result
      // 默认选择第一条剖面线（仅本地 ref）
      if (profiles.value.length > 0) {
        selectedProfileId.value = profiles.value[0].id
      }
    } else {
      showError('加载剖面线数据失败')
    }
  } catch (error) {
    logger.error('加载剖面线失败:', error)
    // 失败用 toast：重新选择剖面/切换水位即自动重试
    showError(error, { fallback: '加载剖面线数据失败' })
  }
}

/** 当前选中的剖面数据 */
function getCurrentProfile() {
  return profiles.value.find((p) => p.id === selectedProfileId.value)
}

/** 初始化图表 */
function initChart() {
  if (!chartContainerRef.value) return

  // 如果已有实例，先销毁
  if (chartInstance) {
    chartInstance.dispose()
  }

  chartInstance = echarts.init(chartContainerRef.value)
}

/** 更新剖面图表 */
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

  const waterLevel = floodStore.waterLevel

  // 配置ECharts选项
  const option = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: TooltipFormatterParam[]) => {
        const distance = params[0]?.axisValue
        let content = `距离: ${distance}m<br/>`
        params.forEach((param: TooltipFormatterParam) => {
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

  // 增量更新：notMerge=false 保留轴/样式，replaceMerge:['series'] 整体替换系列防残留，lazyUpdate 延迟渲染
  // perfTimeFn 闭包内 TS 无法收窄 chartInstance，故先取局部常量
  const inst = chartInstance
  perfTimeFn('echarts:setOption:waterLevel', () => {
    inst.setOption(option, { notMerge: false, replaceMerge: ['series'], lazyUpdate: true })
  })
}

/** 剖面线选择变化时更新图表（仅本地 ref，store 侧无读方） */
watch(selectedProfileId, () => {
  updateChart()
})

/** 水位变化时更新水位线 */
watch(
  () => floodStore.waterLevel,
  () => {
    if (chartInstance && selectedProfileId.value) {
      updateChart()
    }
  }
)

/** 挂载时加载剖面线并初始化图表 */
onMounted(() => {
  void loadProfiles()
  initChart()

  // 监听窗口大小变化
  window.addEventListener('resize', handleResize)
})

/** 处理窗口大小变化 */
function handleResize() {
  if (chartInstance) {
    chartInstance.resize()
  }
}

/** 卸载时销毁图表并移除监听 */
onUnmounted(() => {
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }

  window.removeEventListener('resize', handleResize)
  // 卸载时若滑块专注模式仍激活立即退出，避免拖到一半切路由后残留导致下页面板全透明
  endSliderFocus()
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
        :max="15"
        :step="0.1"
        :show-tooltip="false"
        @pointerdown="beginSliderFocus($event.currentTarget as HTMLElement)"
        @pointerup="endSliderFocus"
        @pointercancel="endSliderFocus"
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
  background: var(--GCS-bg-panel-translucent);
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
  color: var(--GCS-text-primary);
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
  color: var(--GCS-text-secondary);
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
  color: var(--GCS-text-muted);
  padding: 2px 0;
}

.scale-mark {
  cursor: pointer;
  transition: color 0.2s;
}

.scale-mark.clickable {
  color: var(--GCS-color-primary);
  font-weight: 500;
}

.scale-mark.clickable:hover {
  color: var(--GCS-color-primary-hover);
  text-decoration: underline;
}
</style>
