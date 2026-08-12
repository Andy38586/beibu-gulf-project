<script setup lang="ts">
/**
 * 雷达图面板：顶部标题、中部雷达图、底部可点击综合评分。
 * 点击评分弹出具体得分浮窗（1 列 6 行）；点击轴名称显示对应设施 POI 图层（互斥）。
 * 渲染与交互逻辑封装在 useRadarChart
 */

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { useGCS } from '@/shared'
import { logger } from '@/shared'
import type { FacilityPoint } from '@/types/facility'
import type { ScoredXiaoqu } from '@/types/xiaoqu'

import RadarScoreTooltip from './components/RadarScoreTooltip.vue'
import { useRadarChart } from './composables/useRadarChart'

interface Props {
  visible: boolean
  xiaoqu: ScoredXiaoqu | null
  selectedTypes: string[]
  embedded: boolean
  facilityPoi: Record<string, FacilityPoint[]>
  /** 雷达图标题，默认显示"xx小区评分详情图" */
  title?: string
}

interface Emits {
  (
    _e: 'show-facility-layer',
    _data: {
      type: string
      poiList: FacilityPoint[]
      color: string
      label: string
    }
  ): void
  (_e: 'hide-facility-layer'): void
}

const props = withDefaults(defineProps<Props>(), {
  visible: true,
  xiaoqu: null,
  selectedTypes: () => [],
  embedded: false,
  facilityPoi: () => ({}),
  title: '',
})

/** 标题优先用传入值，缺省为"xx小区评分详情图" */
const displayTitle = computed(() => {
  if (props.title) return props.title
  if (props.xiaoqu?.name) return `${props.xiaoqu.name}评分详情图`
  return '评分详情图'
})

const emit = defineEmits<Emits>()

const chartRef = ref<HTMLElement | null>(null)

const { cellPixel } = useGCS()
const unitPx = computed(() => cellPixel.value * 0.1)

/** 使用 useRadarChart composable 处理雷达图逻辑 */
const {
  tooltipVisible,
  tooltipPosition,
  renderRadar,
  handleScoreClick,
  handleGlobalClick,
  setupResizeObserver,
} = useRadarChart({
  getChartRef: () => chartRef.value,
  getProps: () => props,
  emit,
})

// 标记监听器是否已添加，防止泄漏
let globalClickListenerAdded = false

watch(
  () => tooltipVisible.value,
  (val) => {
    if (val) {
      // 立即添加监听器，不使用 setTimeout 延迟
      if (!globalClickListenerAdded) {
        window.addEventListener('click', handleGlobalClick)
        globalClickListenerAdded = true
      }
    } else {
      window.removeEventListener('click', handleGlobalClick)
      globalClickListenerAdded = false
    }
  }
)

watch(
  () => props.visible,
  (val) => {
    if (val) {
      void nextTick(() => renderRadar())
    }
  }
)

watch(
  [() => props.xiaoqu, () => props.selectedTypes, () => props.facilityPoi],
  ([newXiaoqu, newTypes, newPoi]) => {
    logger.debug('[RadarChart] 数据变化:', { xiaoqu: newXiaoqu, types: newTypes, poi: newPoi })
    setupResizeObserver()
    void nextTick(() => renderRadar())
  },
  {
    flush: 'post',
  }
)

// 组件卸载时清理全局监听器
onBeforeUnmount(() => {
  window.removeEventListener('click', handleGlobalClick)
  globalClickListenerAdded = false
})
</script>

<template>
  <div class="radar-panel">
    <!-- 顶部：标题（与浸没分析一致：16px/600 加粗） -->
    <div class="radar-title">{{ displayTitle }}</div>

    <!-- 中部：雷达图容器 -->
    <div class="radar-container">
      <div v-if="xiaoqu" ref="chartRef" class="radar-chart"></div>
      <div v-else class="empty-state">请在结果列表中选择小区查看雷达图</div>
    </div>

    <!-- 底部：综合评分（可点击） -->
    <div v-if="xiaoqu" class="score-text clickable" @click.stop="handleScoreClick">
      综合评分：{{ xiaoqu.score }}
    </div>

    <!-- 具体得分浮窗（使用子组件） -->
    <RadarScoreTooltip
      :visible="tooltipVisible"
      :xiaoqu="xiaoqu"
      :selected-types="selectedTypes"
      :position="tooltipPosition"
    />
  </div>
</template>

<style scoped>
.radar-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0;
  box-sizing: border-box;
  position: relative;
}

/* 标题：与浸没分析一致（16px/600，不顶格） */
.radar-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--GCS-text-primary);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: calc(4 * v-bind(unitPx)) 0 calc(2 * v-bind(unitPx));
}

/* 雷达图容器：flex 占满剩余空间，内部用 absolute 确保 ECharts 有确定尺寸 */
.radar-container {
  flex: 1;
  min-height: 0;
  position: relative;
}

.radar-chart {
  position: absolute;
  inset: 0;
}

.empty-state {
  color: var(--GCS-text-muted);
  font-size: 13px;
  text-align: center;
}

/* 综合评分：距雷达图 0.2 cell，距 panel 底部 0.2 cell */
.score-text {
  color: var(--GCS-color-primary);
  font-weight: 500;
  margin: 0;
  font-size: 14px;
  text-align: center;
  margin-top: calc(2 * v-bind(unitPx));
  margin-bottom: calc(2 * v-bind(unitPx));
}

.score-text.clickable {
  cursor: pointer;
  transition: color 0.2s;
}

.score-text.clickable:hover {
  color: var(--GCS-color-primary-hover);
}
</style>
