<!--
  /**
   * 预测分析模块：纯 API 链路（cargo/container 为后端模型预测的真实吞吐量，
   * activity 为真数据派生「港口吞吐活跃度」指数——berth/traffic 纯合成指标已下架）。
   * 验证 heatmap 图层注册/销毁、纯 2D 业务承载与时间轴驱动的图层增量更新性能。
   * 布局：左 LineChart + BarChart，右 ForecastControlPanel + LayerControlPanel（各 4×4）
   */
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { AppLayout, GCSPanel, LayerControlPanel, StackSlot } from '@/core'
import {
  DEFAULT_LAYER_ORDER,
  forecastLayerId,
  isStackSlotZone,
  logger,
  useProfileSnapshot,
} from '@/shared'
import { useForecastStore } from '@/stores'
import { useMapStore } from '@/stores'
import type { ForecastSavedState } from '@/stores/forecastStore'
import { BarChart, ChartLoading, LineChart } from '@/visualization'

import ForecastControlPanel from './components/ForecastControlPanel.vue'
import { useForecastLayer } from './composables/useForecastLayer'
import { provideForecastOrchestrator } from './composables/useForecastOrchestrator'

/**
 * 图层面板里预测层的展示顺序（面板按「货 → 活 → 箱」排）。
 *
 * 注意：它与注册顺序 `FORECAST_INDICATORS`（货 → 箱 → 活）**不一致** —— 这是既存事实，
 * 本笔只把 key 的来源收到 `forecastLayerId`（原先这里手抄 3 个图层 key 字面量，
 * 指标一改名面板按钮就与目录条目对不上而静默消失），**不改可见顺序**：
 * 面板顺序该不该与注册顺序统一属产品可见口径，须单独裁。
 */
const FORECAST_PANEL_ORDER: string[] = ['cargo', 'activity', 'container'].map(forecastLayerId)

const forecastState = useForecastStore()
const mapStore = useMapStore()

// v4-S3：三路事务编排器单实例（页面创建并 provide，面板 inject 后发起用户请求——
// AbortController 是实例级持有，两份实例会裂开竞态守卫）。
// ⚠️ 图层能力仍由**页面**自己取（owned-layers 守卫口径：建 owner 册的 composable 必须页面直调），
// 再注入编排器复用——归属随页面作用域，不会因子组件卸载而丢。
const { updateForecastLayer } = useForecastLayer()
const { doForecastUpdate, cancelAll } = provideForecastOrchestrator({ updateForecastLayer })

// ── v4-S9 系统 D：可视化面板堆叠（固定槽位，iOS Stack）──
// 图表面板拖入右侧堆叠槽（只露卡头，点击展开，可还原）；dock 投递区对图表面板无意义
//（图表面板不是任务）⇒ 落 dock 忽略（usePanelDrag 自动回滚原位）。
const stackedPanels = ref<string[]>([])
const STACKABLE_PANELS = [
  { id: 'line', label: '预测趋势' },
  { id: 'bar', label: '港口对比' },
] as const
const stackItems = computed(() =>
  STACKABLE_PANELS.filter((p) => stackedPanels.value.includes(p.id)).map((p) => ({
    id: p.id,
    label: p.label,
  }))
)
function onPanelDrop(panelId: string, zone: HTMLElement): void {
  if (isStackSlotZone(zone)) stackedPanels.value.push(panelId)
}
function restorePanel(id: string): void {
  stackedPanels.value = stackedPanels.value.filter((p) => p !== id)
}

/** 跳转个人中心（登录）时保存状态，返回恢复；其它路由离开清除快照（对齐浸没/选址页先例） */
useProfileSnapshot({
  save: saveForecastState,
  clear: () => forecastState.clearState(),
})

/** 保存当前状态到 store 快照（requestCache 序列化为数组，避免引用连带清空） */
function saveForecastState(): void {
  forecastState.saveState({
    currentTime: forecastState.currentTime,
    timeGranularity: forecastState.timeGranularity,
    playSpeed: forecastState.playSpeed,
    activeIndicator: forecastState.activeIndicator,
    canalScenario: forecastState.canalScenario,
    confidenceThresholds: { ...forecastState.confidenceThresholds },
    activeForecastLayer: forecastState.activeForecastLayer,
    requestCache: Array.from(forecastState.requestCache.entries()),
  })
}

/** 恢复快照：一次性收口到 store action；renderer watch（immediate）兜底触发加载 */
function restoreForecastState(saved: ForecastSavedState): void {
  forecastState.restoreState(saved)
}

onMounted(() => {
  // 跳登录返回优先恢复快照（不 reset，避免清掉刚恢复的状态）；无快照才走初始化
  const savedState = forecastState.consumeState()
  if (savedState) {
    restoreForecastState(savedState)
    return
  }
  forecastState.reset()
})

watch(
  () => mapStore.currentRenderer,
  (r) => {
    logger.debug('[ForecastPage] renderer watch triggered:', r ? 'renderer ready' : 'renderer null')
    if (r) {
      logger.debug('[ForecastPage] loading data...')
      void doForecastUpdate()
    } else {
      logger.debug('[ForecastPage] renderer is null, waiting...')
    }
  },
  { immediate: true }
)

// 切离 cargo 时立即复位运河情景（cargo 之外无文献参数口径，后端 400；
// 不进防抖——复位是状态修正不是请求）
watch(
  () => forecastState.activeIndicator,
  (ind) => {
    if (ind !== 'cargo' && forecastState.canalScenario !== 'baseline') {
      forecastState.setCanalScenario('baseline')
    }
  }
)

// v4-S3：参数变化的三路刷新已上移 ForecastControlPanel（防抖 + 发起都在面板——
// 请求归属口径"面板管要什么"）；本页只保留渲染器就绪这一次渲染侧初始化触发。

onUnmounted(() => {
  cancelAll()
  // 图层注销不由本页负责：注册经 useOwnedLayers 登记归属，卸载由 onScopeDispose 统一清
  forecastState.reset()
})
</script>

<template>
  <div class="forecast-page">
    <AppLayout>
      <template #left>
        <GCSPanel
          v-if="!stackedPanels.includes('line')"
          :w="4"
          :h="4"
          anchor="top-left"
          :offset-x="0"
          :offset-y="1.25"
          draggable
          @drop="(z: HTMLElement) => onPanelDrop('line', z)"
        >
          <LineChart
            title="预测趋势"
            :x-data="forecastState.chart.lineXData"
            :series="forecastState.chart.lineSeries"
            :x-min="forecastState.chart.lineViewportXMin"
            :x-max="forecastState.chart.lineViewportXMax"
          />
          <!-- 数据刷新期 loading 覆盖（isRequesting 由事务 composable 驱动），
               原注释"加载态不绑定 UI"已废止——弱网下用户可感知更新进行中 -->
          <ChartLoading v-if="forecastState.isRequesting" />
        </GCSPanel>
        <GCSPanel
          v-if="!stackedPanels.includes('bar')"
          :w="4"
          :h="4"
          anchor="top-left"
          :offset-x="0"
          :offset-y="5.5"
          draggable
          @drop="(z: HTMLElement) => onPanelDrop('bar', z)"
        >
          <BarChart
            title="港口对比"
            :x-data="forecastState.chart.barXData"
            :series="forecastState.chart.barSeries"
          />
          <ChartLoading v-if="forecastState.isRequesting" />
        </GCSPanel>
      </template>
      <template #right>
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <ForecastControlPanel />
        </GCSPanel>
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel :layer-order="[...DEFAULT_LAYER_ORDER, ...FORECAST_PANEL_ORDER]" />
        </GCSPanel>
      </template>
    </AppLayout>
    <!-- v4-S9 系统 D：可视化面板堆叠槽（空态零占位；拖拽期显形命中框） -->
    <StackSlot :items="stackItems" @restore="restorePanel" />
  </div>
</template>

<style scoped>
.forecast-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.forecast-page :deep(.GCS-panel) {
  pointer-events: auto;
}
</style>
