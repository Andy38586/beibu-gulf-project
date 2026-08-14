<script setup lang="ts">
/**
 * 雷达图面板：顶部标题、中部雷达图（最大化居中）、底部可点击综合评分。
 * hover 综合评分出现提示框，点击弹出具体得分详情面板（居中，1 列 6 行）；
 * 点击轴名称显示对应设施 POI 图层（互斥）。渲染与交互逻辑封装在 useRadarChart
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

const emit = defineEmits<Emits>()

const chartRef = ref<HTMLElement | null>(null)
const scoreAreaRef = ref<HTMLElement | null>(null)

const { cellPixel } = useGCS()
const unitPx = computed(() => `${cellPixel.value * 0.1}px`)

/** 使用 useRadarChart composable 处理雷达图逻辑（chartRef 由组件声明，模板 v-if 绑定） */
const {
  tooltipVisible,
  tooltipPosition,
  renderRadar,
  handleScoreClick,
  handleGlobalClick,
  setupResizeObserver,
} = useRadarChart({
  chartRef,
  getScoreAreaRef: () => scoreAreaRef.value,
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
    <!-- 中部：雷达图容器（标题由 ECharts 绘制，与 LineChart/BarChart 一致） -->
    <div class="radar-container">
      <div v-if="xiaoqu" ref="chartRef" class="radar-chart"></div>
    </div>

    <!-- 底部：综合评分（hover 出现提示框，点击查看详细得分） -->
    <div v-if="xiaoqu" ref="scoreAreaRef" class="score-area">
      <div class="score-text clickable" @click.stop="handleScoreClick">
        综合评分：{{ xiaoqu.score }}
      </div>
      <div class="score-hint" @click.stop="handleScoreClick">点击查看详细得分</div>
    </div>

    <!-- 具体得分详情面板（在雷达面板内居中，不遮挡综合评分） -->
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

/* 雷达图容器：flex 占满剩余空间，内部用 absolute 确保 ECharts 有确定尺寸 */
.radar-container {
  flex: 1;
  min-height: 0;
  position: relative;
  z-index: 2;
}

.radar-chart {
  position: absolute;
  inset: 0;

  /* 高于评分 hover 提示框：雷达画布始终在评分区域上方，不被文字留白遮挡 */
  z-index: 2;
}

/* 综合评分：低于雷达图层（z 1 < radar-container z 2），确保雷达图内容不被文字/留白遮挡 */
.score-area {
  position: relative;
  z-index: 1;
}

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

/* 提示框：紧贴综合评分文字上方居中，hover 评分区域时浮现 */
.score-hint {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1;
  white-space: nowrap;
  padding: 2px 6px;
  font-size: 11px;
  color: var(--GCS-text-secondary);
  background: var(--GCS-bg-elevated);
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-sm);
  box-shadow: var(--GCS-shadow-sm);
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.15s ease,
    visibility 0.15s;
  margin-bottom: -20px;
}

.score-area:hover .score-hint {
  opacity: 1;
  visibility: visible;
}
</style>
