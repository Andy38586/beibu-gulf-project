<script setup lang="ts">
/**
 * 水位滑块与剖面分析面板：滑块控制水位（0-10m，海平面/EGM96 基准，0.1m 步进；
 * 0 = 平均海平面）、点击等距刻度标记、下拉选择预设剖面线，自动显示高程剖面图
 * 并叠加当前水位线。布局 4×4，右上角。
 * 刻度 5 档等距纯数值（0/2.5/5/7.5/10，下方三上方二）；风险语义由标题行动态徽章
 * 实时承载（deriveRiskLevelDisplay，与后端 RISK_LEVEL_BANDS 同表）。后端数据全域
 * 0-25 保留，展示域收口见 FLOOD_DISPLAY_MAX_WATER_LEVEL。
 *
 * ── v4-S3 改动（请求归属收进本面板）──────────────────────────────────────────
 * 本面板现在是**浸没路由的唯一请求发起者**（原发起者为页面）。水位变化后经
 * `useFloodRequest` 取「淹没范围 + 统计 + 影响评估」，拿到结果调页面注入的
 * 渲染回调写 store + 上图。
 *
 * 🔴 **两条路径**（见 useFloodRequest 头注释）：
 *   · 滑块拖动 / 点刻度 / 恢复 → **直连**（`viaTask = false`），与 v3 完全一致
 *   · 拖入 dock 后的后台续跑 → **任务**（`viaTask = true`），淹没范围走后端异步任务域
 *   为什么滑块不能走队列：flood 是连续手势，一次拖动 5~10 轮会把并发上限为 1、
 *   容量为 8 的后端队列打满，滑块会卡死——与"体验/布局保持一致"直接冲突。
 *
 * 🔴 保活语义：面板被拖进 dock / 页面卸载后，**后端任务照常跑完**（状态住 taskStore），
 *    故本面板 `onUnmounted` 绝不调 `taskStore.cancel()`，只清自己的 UI 计时器。
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
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useSliderFocus } from '@/core'
import {
  deriveRiskLevelDisplay,
  FLOOD_DISPLAY_MAX_WATER_LEVEL,
  PROFILE_AREA_STOP_STRONG,
  PROFILE_AREA_STOP_WEAK,
  PROFILE_COLORS,
} from '@/shared'
import { useGCS } from '@/shared'
import { perfTimeFn } from '@/shared'
import { useFloodStore, useTaskStore } from '@/stores'
import { isActiveStatus } from '@/types/task'

import type { FloodAnalysisPayload } from '../composables/useFloodRequest'
import {
  FLOOD_ANALYSIS_DELAY,
  FLOOD_ROUTE_PATH,
  useFloodRequest,
} from '../composables/useFloodRequest'
import { useTerrainProfiles } from '../composables/useTerrainProfiles'

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

/** 剖面线数据结构见 ../composables/useTerrainProfiles（本地重复接口已收口移除） */

/**
 * 请求能力（v4-S3）：本面板是唯一调用方。
 *
 * 🔴 面板只管"要什么"，不管"怎么画"——画由页面注入的 `renderers` 做，
 *    因为图层 manager 与图表 ref 都在页面 scope 里（面板自己 new 一份
 *    composable 只会写进另一份闭包，地图/图表永远不动）。
 */
const { fetchAnalysis, fetchImpact, abortInflight } = useFloodRequest()

const floodStore = useFloodStore()
const taskStore = useTaskStore()
// 滑块专注模式（安卓控制中心风格）：拖动水位滑块时隐藏其他面板，只留本面板
const { beginSliderFocus, endSliderFocus } = useSliderFocus()
// 直接从 useGCS 解构 CSS 变量供 v-bind() 使用
const { cell8px, cell16px } = useGCS()

/**
 * 页面恢复标志（由父页面传入）。
 *
 * · `stateRestored`：页面正在从快照恢复 ⇒ 抑制本面板的自动首屏请求（快照里已有数据）。
 *
 * 🔴 2026-09-19：原 `docked` prop 已删除。语义修正后「面板让位排队」不影响本面板的
 *    可见性与交互（面板始终在原位），故不需要该 prop 做任何渲染/行为分支。
 */
const props = defineProps<{
  stateRestored?: boolean
}>()

// ── 渲染回调注入（与 forecast 面板同款）──────────────────────────────────────
interface FloodRenderers {
  analysis?: (payload: {
    features: unknown[]
    statistics: unknown
    riskLevel: string
    actualWaterLevel?: number
  }) => void
  impact?: (payload: { affectedFacilities: unknown[]; totalLoss: number }) => void
  waterSurface?: (level: number) => void
}

const renderers: FloodRenderers = {}

/** 供页面注入渲染回调（页面在 onMounted 时调用） */
function registerRenderers(next: FloodRenderers): void {
  Object.assign(renderers, next)
}

/** 面板 UI 状态（与服务端任务状态无关） */
const requesting = ref(false)

/** 卸载标志：卸载后任务仍在后端跑，但不该再写 UI 状态 */
let disposed = false

/** 水位防抖定时器（滑块拖动期间合并为一次请求） */
let analysisTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 跑一轮完整分析（淹没范围 → 影响评估）。
 *
 * ## 为什么两路串行
 * 后端队列并发上限为 1（任务路径），并发提交只会排队；串行还能让"先看到淹没范围"
 * 这个主结果先落地。直连路径两路互不依赖，但也保持串行以免瞬时四请求。
 *
 * ## 为什么失败不互相拖垮
 * 淹没范围与影响评估是**独立**的展示需求（地图多边形 / 右下面板列表）。
 * 前者失败不该让后者不显示，反之亦然。
 *
 * @param waterLevel 目标水位
 * @param viaTask true = 淹没范围走后端异步任务域（dock 续跑场景）
 */
async function runAnalysis(waterLevel: number, viaTask = false): Promise<void> {
  if (disposed) return

  requesting.value = true
  try {
    const analysis = await fetchAnalysis(waterLevel, viaTask)
    if (disposed) return
    if (analysis) {
      renderers.analysis?.({
        features: analysis.features,
        statistics: analysis.statistics,
        riskLevel: analysis.riskLevel,
        actualWaterLevel: analysis.actualWaterLevel,
      })
      // 水面几何：以**后端实际命中档位**抬升（可能被向上取档，与请求水位不同）
      if (typeof analysis.actualWaterLevel === 'number') {
        renderers.waterSurface?.(analysis.actualWaterLevel)
      }
    }

    const impact = await fetchImpact(waterLevel)
    if (disposed) return
    if (impact) {
      renderers.impact?.({
        affectedFacilities: impact.affectedFacilities,
        totalLoss: impact.totalLoss,
      })
    }
  } finally {
    if (!disposed) requesting.value = false
  }
}

/**
 * 滑块变化 → 防抖后**直连**跑一轮。
 *
 * 🔴 这里**刻意不传 viaTask**：滑块是连续手势，走队列会打满后端并发上限为 1 的队列。
 *    用户在 dock 里"后台跑"的那次续跑由 `dockToTask()` 触发（拖拽 drop 事件链）。
 */
function scheduleAnalysis(level: number): void {
  if (analysisTimer) clearTimeout(analysisTimer)
  analysisTimer = setTimeout(() => {
    analysisTimer = null
    void runAnalysis(level, false)
  }, FLOOD_ANALYSIS_DELAY)
}

/**
 * 被拖入投递区 ⇒ 以**当前水位**提交一次后端任务，并标记该任务「让位排队」。
 *
 * ## 为什么必须在这里提交（而不是只 setDocked）
 *
 * `docked` 标记住在 `TaskSlot` 上，而**槽位只有提交任务时才创建**。
 * 若只 `setDocked(route, true)`：槽不存在 ⇒ store 直接 return，什么都没发生。
 * ⇒ 「拖入投递区」必须与「确保有任务」是**同一个原子动作**。
 *
 * ## 语义澄清（2026-09-19）
 *
 * `setDocked(true)` **不代表面板收起** —— 面板永远在原位可用。
 * 它只表达"用户主动把该路由的任务降为后台排队"，并作为导航环的保留判据。
 * 真正的降级由 `taskStore.submit` 的 `route === currentRoute` 自动完成。
 *
 * ## 为什么失败要返回 false
 *
 * 提交失败（后端不可达 / 队列满）时页面会 toast 提示，且不得留下
 * "以为已经转后台了"的错觉。故用返回值把结果交给页面决定反馈文案。
 *
 * 返回是否成功，供页面决定要不要提示失败。
 */
async function dockToTask(): Promise<boolean> {
  if (disposed) return false

  // 已有活跃任务在跑 ⇒ 不重复提交，仅标记让位（复用进行中的那次）
  const existing = taskStore.getSlot(FLOOD_ROUTE_PATH)
  if (existing && isActiveStatus(existing.status)) {
    taskStore.setDocked(FLOOD_ROUTE_PATH, true)
    return true
  }

  if (analysisTimer) {
    clearTimeout(analysisTimer)
    analysisTimer = null
  }
  abortInflight()

  requesting.value = true
  try {
    const { slot } = await taskStore.submitAndWait({
      route: FLOOD_ROUTE_PATH,
      domain: 'flood-areas',
      params: { waterLevel: floodStore.waterLevel },
    })
    if (disposed) return false

    // 任务被移除（dismiss/clearAll）：不置停靠态
    if (!slot) return false

    // 结果由 renderers 消费（面板停靠后页面仍持有渲染回调）
    if (slot.status === 'done' && slot.result) {
      const payload = slot.result as FloodAnalysisPayload
      renderers.analysis?.({
        features: payload.features,
        statistics: payload.statistics,
        riskLevel: payload.riskLevel,
        actualWaterLevel: payload.actualWaterLevel,
      })
      if (typeof payload.actualWaterLevel === 'number') {
        renderers.waterSurface?.(payload.actualWaterLevel)
      }
    }

    taskStore.setDocked(FLOOD_ROUTE_PATH, true)
    return true
  } catch {
    // 提交失败：保持面板在原位，让用户能继续操作（页面侧负责 toast）
    return false
  } finally {
    if (!disposed) requesting.value = false
  }
}

onMounted(() => {
  // 首屏：快照恢复时页面已有数据，本面板不再自动跑（stateRestored 抑制）
  if (!props.stateRestored) {
    void runAnalysis(floodStore.waterLevel, false)
  }
  void loadProfiles(profileAbortController.signal)
  initChart()

  // 监听窗口大小变化
  window.addEventListener('resize', handleResize)
})

/**
 * 水位变化 → 防抖后排一轮分析（**滑块/刻度/恢复的唯一入口**）。
 *
 * 不区分变化来源：`setWaterLevel` 由滑块、刻度点击、快照恢复三处共用，
 * 都该触发同一套"取数 + 上图"，故用 watch 而非在事件处理里直接调。
 */
watch(
  () => floodStore.waterLevel,
  (level) => {
    // 🔴 2026-09-19 语义修正：不再因 `docked` 拦截。
    //    `docked` = 任务让位排队，**面板仍在原位可见可交互**（用户拖不到它的前提已不成立）。
    //    只保留卸载守卫（`disposed`）避免对已销毁实例发请求。
    if (disposed) return
    scheduleAnalysis(level)
  }
)

// 水位滑块改为「store 单一事实源」的可写 computed——
// 原 localWaterLevel ref + watch 反向同步属双源复制模式（指标 4.1 反模式），
// 快照恢复/外部写入（setWaterLevelByMark）均自动一致
const localWaterLevel = computed<number>({
  get: () => floodStore.waterLevel,
  set: (v: number) => floodStore.setWaterLevel(v),
})

/**
 * 可点击刻度标记（5 档等距：0/2.5/5/7.5/10，25% 等距，纯数值标签；步进 0.1m 手感）。
 * 风险语义不走静态刻度——阈值（0/2/5/8/10，backend RISK_LEVEL_BANDS 同源）与等距
 * 位置对不齐，硬贴档名会错档；改为标题行"当前风险"动态徽章实时显示
 *（deriveRiskLevelDisplay，同一张分级表），语义与美感兼得（2026-09-12 用户口径）。
 * row 控制上下排布；value 同时是点击跳转的水位与轨道百分比
 *（value/FLOOD_DISPLAY_MAX_WATER_LEVEL）
 */
const scaleMarks = [
  { label: '0m', value: 0, row: 'bottom' },
  { label: '2.5m', value: 2.5, row: 'top' },
  { label: '5m', value: 5, row: 'bottom' },
  { label: '7.5m', value: 7.5, row: 'top' },
  { label: '10m', value: 10, row: 'bottom' },
] as const

/** 末位标记（10m=展示域上限）：--last 样式锚点随标记数组派生 */
const lastMark = scaleMarks[scaleMarks.length - 1]

/** 当前水位对应的风险等级（动态徽章文案；分级阈值见 shared/constants/flood.ts） */
const currentRiskLabel = computed(() => deriveRiskLevelDisplay(floodStore.waterLevel))

/** 滑块变化直接写 store；防抖由父组件统一处理（可写 computed 的 set 即写 store） */
function onSliderChange(value: number | number[]) {
  const level = Array.isArray(value) ? value[0] : value
  floodStore.setWaterLevel(level)
}

function setWaterLevelByMark(value: number) {
  floodStore.setWaterLevel(value)
}

/** 剖面线列表与选中态（收口至 useTerrainProfiles，组件不再直调 apiRequest） */
const { profiles, selectedProfileId, loadProfiles, getCurrentProfile } = useTerrainProfiles()

/** ECharts实例 */
let chartInstance: EChartsType | null = null

/** ECharts容器DOM引用 */
const chartContainerRef = ref<HTMLElement | null>(null)

/**
 * 剖面线请求取消控制器：卸载时 abort 在途请求（signal 透传给 useTerrainProfiles）。
 * 不取消时，切页后迟到的响应仍会写 profiles/selectedProfileId（组件已销毁，
 * Vue 对已卸载组件的 ref 写入会静默失败并伴随内存滞留）。
 */
const profileAbortController = new AbortController()

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

  // 提取距离和高程数据；海平面基准统一口径（浸没基准重派生 P4）——
  // 地形 EGM96 高程原值直绘，水位线 = 滑块值（0 = 平均海平面），不再 +datumOffset：
  // datumOffset（深度基准 → EGM96 的 +2.5）随基准统一退役，metadata 字段仅过渡期保留
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
      // 口径说明由刻度行「基准面 0m」承载；轴名过长会与顶部图例重叠
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
            { offset: 0, color: PROFILE_AREA_STOP_STRONG },
            { offset: 1, color: PROFILE_AREA_STOP_WEAK },
          ]),
        },
      },
      {
        name: '水位线',
        type: 'line',
        // 海平面基准口径：地形为 EGM96 原值，水位线 = 滑块值（0 = 平均海平面）
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

/** 处理窗口大小变化 */
function handleResize() {
  if (chartInstance) {
    chartInstance.resize()
  }
}

/** 卸载时销毁图表并移除监听 */
onUnmounted(() => {
  disposed = true

  // ═══ v4-S3 逐条判定：什么该清、什么绝不能清 ═══
  //
  // ✅ **可清（UI 状态，属于本组件）**：
  //   · 剖面线请求 —— 组件没了就没人展示剖面，abort 掉
  //   · ECharts 实例 / window resize 监听 —— 组件级资源
  //   · 水位防抖定时器 —— 卸载后再排请求无意义
  //   · endSliderFocus —— 不清会让下个页面板全透明（既有修复）
  //
  // 🔴 **不可清（任务状态，属于 taskStore）**：
  //   · 后端洪涝任务 —— 严禁在此调 taskStore.cancel()！用户把面板拖进 dock
  //     正是为了"页面不管了它还得跑"；这里取消等于把保活功能当场废掉。
  //     任务终止只由三件事触发：用户点取消 / 被同路由新任务取代 / 登出清空。
  //   · 在途任务轮询句柄 —— 住在 store（pollTimers），不随组件销毁。
  //
  // 🔴 `abortInflight()` 只 abort **直连 HTTP**，不碰后端任务（见 useFloodRequest 头注释）。
  abortInflight()
  if (analysisTimer) {
    clearTimeout(analysisTimer)
    analysisTimer = null
  }

  // 卸载即取消在途剖面请求（signal 已透传 useTerrainProfiles），
  // 迟到的响应不再写回已销毁组件
  profileAbortController.abort()

  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }

  window.removeEventListener('resize', handleResize)
  // 卸载时若滑块专注模式仍激活立即退出，避免拖到一半切路由后残留导致下页面板全透明
  endSliderFocus()
})

defineExpose({ registerRenderers, dockToTask })
</script>

<template>
  <div class="water-level-profile-panel">
    <!-- 标题区 -->
    <div class="panel-header">
      <div class="header-title">
        剖面分析
        <span class="risk-badge">{{ currentRiskLabel }}</span>
      </div>
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
        :max="FLOOD_DISPLAY_MAX_WATER_LEVEL"
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
          :class="[
            mark.row === 'top' ? 'scale-mark--top' : 'scale-mark--bottom',
            { 'scale-mark--first': mark.value === 0, 'scale-mark--last': mark === lastMark },
          ]"
          :style="{ left: (mark.value / FLOOD_DISPLAY_MAX_WATER_LEVEL) * 100 + '%' }"
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
  font-size: var(--GCS-font-size-lg); /* 面板标题字号归档 */
  font-weight: 600;
  color: var(--GCS-text-primary);
}

/* 当前风险动态徽章：滑块水位实时分级（RISK_LEVEL_THRESHOLDS 同一涨表），
   语义由徽章承载、刻度保持等距数值（两者解耦——阈值与等距位置对不齐） */
.risk-badge {
  margin-left: v-bind(cell8px);
  padding: 0 calc(v-bind(cell8px) / 2);
  font-size: var(--GCS-font-size-xs);
  font-weight: 500;
  color: var(--GCS-color-warning);
  border: 1px solid var(--GCS-color-warning);
  border-radius: calc(var(--GCS-slider-thumb-size) / 2);
  vertical-align: middle;
}

.profile-select {
  /* 固定 px 宽改网格倍数（160px = 2 个 80px cell，随 cellPixel 档位缩放） */
  width: calc(2 * var(--GCS-cell));
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

/* 水位滑块区域：上下留出刻度行净空；position:relative 供 7 档刻度层绝对覆盖 */
.water-slider-container {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
  padding: 22px 0 20px;
}

/* 与选址/预测统一：整条渐变轨道（灰→品牌色）+ 白底描边拇指。
   填充段 bar 隐藏——淹没进度语义由下方快捷刻度承载，视觉与自绘滑块完全一致 */
.water-slider-container :deep(.el-slider__runway) {
  background: linear-gradient(to right, var(--GCS-border-default), var(--GCS-color-primary));
  height: var(--GCS-slider-thumb-size);
  border-radius: calc(var(--GCS-slider-thumb-size) / 2);
}

.water-slider-container :deep(.el-slider__bar) {
  display: none;
}

.water-slider-container :deep(.el-slider__button) {
  width: var(--GCS-slider-thumb-size);
  height: var(--GCS-slider-thumb-size);

  /* 补偿 EP 按 20px 默认拇指计算的垂直定位：自定义 14px 尺寸后原生补偿过度（实测偏上，6px 精准回正） */
  margin-top: 6px;
  background: var(--GCS-color-primary);
  border: 2px solid white;
  box-shadow: 0 1px 3px rgb(0 0 0 / 35%);
}

/* 刻度 7 档上下交错（上 3 下 4）：刻度层绝对覆盖滑块容器，top 行贴滑块上方、
   bottom 行贴滑块下方；left=value/FLOOD_DISPLAY_MAX_WATER_LEVEL 与轨道真实位置一致，nowrap 防折行，
   首尾单侧对齐防溢出面板 */
.scale-marks {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-size: var(--GCS-font-size-xs); /* 越档 11px 归 12px 档 */
  color: var(--GCS-text-muted);
}

.scale-mark {
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.2s;
  pointer-events: auto;
}

/* 上排贴滑块上方、下排贴滑块下方 */
.scale-mark--top {
  top: 0;
}

.scale-mark--bottom {
  bottom: 0;
}

/* 首尾单侧对齐：起点左贴、终点右贴（translateX(-50%) 会溢出面板被裁切） */
.scale-mark--first {
  transform: none;
}

.scale-mark--last {
  transform: translateX(-100%);
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
