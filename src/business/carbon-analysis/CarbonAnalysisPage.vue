<!--
  /**
   * @arch-note 港口碳排放分析模块（架构验收实验）
   *
   * 定位：架构验证第 4 业务 —— 验证新增业务无需改核心引擎
   *
   * 本模块验证目标：
   * 1. 从零新增业务模块，不修改 UnifiedMap / MapRenderer / BusinessLayerManager / GCS
   * 2. carbonAdapter 复用 Data Adapter 模式
   * 3. points 图层独立注册/销毁
   * 4. 与现有 3 个业务（选址/预测/浸没）完全隔离
   *
   * 布局：左侧 LineChart(4×4) + BarChart(4×4)
   *        右侧 控制面板(4×4) + LayerControlPanel(4×4)
   */
-->
<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import AppLayout from '@/core/layout/AppLayout.vue'
import GcsPanel from '@/core/layout/components/GcsPanel.vue'
import LineChart from '@/visualization/charts/LineChart.vue'
import BarChart from '@/visualization/charts/BarChart.vue'
import LayerControlPanel from '@/shared/components/LayerControlPanel.vue'
import { useCarbonState } from '@/stores/carbonState'
import { useMapStore } from '@/stores/map'
import { useBusinessLayers } from '@/core/map/composables/useBusinessLayers'
import { carbonAdapter } from '@/services/adapters'

const carbonState = useCarbonState()
const mapStore = useMapStore()
const { manager } = useBusinessLayers()

const CARBON_LAYER_ID = 'carbon-points'

// ==================== 图表数据 ====================
const lineXData = ref([])
const lineSeries = ref([])
const barXData = ref([])
const barSeries = ref([])

// ==================== 年份选择 ====================
const yearOptions = ref([])

// ==================== 图层注册（复用 BusinessLayerManager） ====================
let layerRegistered = false

function registerCarbonLayer() {
  if (layerRegistered || !manager) return
  layerRegistered = true

  manager.register(CARBON_LAYER_ID, {
    label: '碳排放分布',
    layerType: 'points',
    data: null,
    options: { featureType: 'carbon-point' },
    visible: true,
  })
}

// 渲染器就绪时注册
watch(
  () => mapStore.currentRenderer,
  (r) => {
    if (r) registerCarbonLayer()
  },
  { immediate: true },
)

// ==================== 数据加载 ====================
async function loadData() {
  carbonState.isLoading = true
  try {
    const data = await carbonAdapter.getEmissionData()
    carbonState.setEmissionData(data)
    buildChartData(data)
    buildMapData(data, carbonState.selectedYear)
    buildYearOptions(data)
  } finally {
    carbonState.isLoading = false
  }
}

function buildYearOptions(data) {
  const years = Object.keys(data.ports[0].emissions).sort()
  yearOptions.value = years
  carbonState.selectedYear = years[Math.floor(years.length / 2)]
}

function buildChartData(data) {
  // 折线图：各港口年度趋势
  const years = Object.keys(data.ports[0].emissions).sort()
  lineXData.value = years
  lineSeries.value = data.ports.map(p => ({
    name: p.name,
    data: years.map(y => p.emissions[y]),
  }))

  // 柱状图：当前年份各港口对比
  updateBarChart(data, carbonState.selectedYear)
}

function updateBarChart(data, year) {
  barXData.value = data.ports.map(p => p.name)
  barSeries.value = [{
    name: `${year} 碳排放 (${data.unit})`,
    data: data.ports.map(p => p.emissions[year]),
  }]
}

function buildMapData(data, year) {
  if (!manager.has(CARBON_LAYER_ID)) {
    registerCarbonLayer()
  }

  const maxEmission = Math.max(...data.ports.map(p => p.emissions[year]))
  const geojson = {
    type: 'FeatureCollection',
    features: data.ports.map(p => {
      const emission = p.emissions[year]
      const ratio = emission / maxEmission
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: p.coordinates },
        properties: {
          id: p.id,
          name: p.name,
          emission,
          ratio,
          year,
        },
      }
    }),
  }

  // 用颜色表达排放强度
  const color = ratio => {
    if (ratio > 0.8) return '#F56C6C'   // 高排放
    if (ratio > 0.5) return '#E6A23C'   // 中等
    return '#67C23A'                     // 低排放
  }

  manager.updateData(CARBON_LAYER_ID, {
    data: geojson,
    options: {
      markerColor: '#409EFF',
      markerSize: 14,
      featureType: 'carbon-point',
    },
  })
}

// ==================== 年份切换 ====================
watch(
  () => carbonState.selectedYear,
  (year) => {
    if (!carbonState.emissionData) return
    updateBarChart(carbonState.emissionData, year)
    buildMapData(carbonState.emissionData, year)
  },
)

// ==================== 生命周期 ====================
onMounted(() => {
  loadData()
})

onUnmounted(() => {
  if (manager.has(CARBON_LAYER_ID)) {
    manager.remove(CARBON_LAYER_ID)
  }
  layerRegistered = false
  carbonState.reset()
})
</script>

<template>
  <div class="carbon-analysis-page" v-loading="carbonState.isLoading">
    <AppLayout>
      <template #left>
        <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <div class="panel-content">
            <div class="panel-title">港口碳排放趋势</div>
            <LineChart
              :x-data="lineXData"
              :series="lineSeries"
              :smooth="true"
              unit="千吨 CO2"
            />
          </div>
        </GcsPanel>

        <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <div class="panel-content">
            <div class="panel-title">{{ carbonState.selectedYear }} 年各港口碳排放对比</div>
            <BarChart
              :x-data="barXData"
              :series="barSeries"
              unit="千吨 CO2"
            />
          </div>
        </GcsPanel>
      </template>

      <template #right>
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <div class="panel-content control-panel">
            <div class="panel-title">碳排放参数</div>
            <div class="control-group">
              <label>分析年份</label>
              <el-select
                v-model="carbonState.selectedYear"
                placeholder="选择年份"
                size="small"
                style="width: 100%"
              >
                <el-option
                  v-for="year in yearOptions"
                  :key="year"
                  :label="year + ' 年'"
                  :value="year"
                />
              </el-select>
            </div>
            <div class="control-group">
              <label>排放类别</label>
              <div class="category-tags">
                <el-tag
                  v-for="cat in (carbonState.emissionData?.categories || [])"
                  :key="cat"
                  size="small"
                  type="info"
                  style="margin: 2px"
                >
                  {{ cat }}
                </el-tag>
              </div>
            </div>
            <el-divider />
            <div class="emission-summary">
              <p v-if="carbonState.emissionData">
                数据单位：{{ carbonState.emissionData.unit }}
              </p>
              <p>覆盖港口：{{ carbonState.ports.length }} 个</p>
              <p>数据范围：{{ yearOptions[0] }} - {{ yearOptions[yearOptions.length - 1] }}</p>
            </div>
          </div>
        </GcsPanel>

        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel />
        </GcsPanel>
      </template>
    </AppLayout>
  </div>
</template>

<style scoped>
.carbon-analysis-page {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  pointer-events: none;
}

.carbon-analysis-page :deep(.gcs-panel) {
  pointer-events: auto;
}

.panel-content {
  width: 100%;
  height: 100%;
  padding: 12px;
  display: flex;
  flex-direction: column;
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
  flex-shrink: 0;
}

.panel-content :deep(.chart-container) {
  flex: 1;
  min-height: 0;
}

.control-panel {
  overflow-y: auto;
}

.control-group {
  margin-bottom: 12px;
}

.control-group label {
  display: block;
  font-size: 13px;
  color: #606266;
  margin-bottom: 4px;
}

.category-tags {
  display: flex;
  flex-wrap: wrap;
}

.emission-summary {
  font-size: 12px;
  color: #909399;
}

.emission-summary p {
  margin: 4px 0;
}
</style>
