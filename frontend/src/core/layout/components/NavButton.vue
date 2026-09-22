<script lang="ts">
export default { name: 'GCSNavButton' }
</script>
<script setup lang="ts">
/**
 * NavButton - 1×1 导航按钮
 * 底部导航条/顶部功能区的最小导航单元：文字在上、图标在下，支持
 * normal/active/disabled 三态；复用 GCSButton 视觉逻辑，仅固定尺寸。
 *
 * ## v4：任务进度环「绕按钮一圈」
 *
 * 传入 `taskRoute` 时，若该路由有任务，则在按钮**外周**画一圈进度环
 * （包裹按钮本体，而非之前贴在右上角的小挂件）。
 *
 * ### 环的显隐口径（用户 2026-09-19 定稿）
 * - 活跃态（pending/running/retrying）⇒ 蓝色环 + 呼吸动画。
 * - `done` ⇒ **绿色环常驻**（用户要看到"跑完了"）。
 * - `failed` ⇒ **红色环常驻**。
 * - **切回该路由时环消失**：因为任务结果的消费者是该页的面板，
 *   用户回到页面即看到结果，环的告知使命已完成。
 *   实现方式＝`showRing` 排除"当前路由"（见下），不依赖任何副作用清理。
 *
 * ### 三条硬约束
 * ① 环 `pointer-events: none` —— 绝不拦截按钮点击（用户明确要求）。
 * ② 环是**绝对定位覆盖层**，不参与流式布局 ⇒ 按钮尺寸零变化（L1 布局铁律）。
 * ③ 环直径 = 按钮边长 + 呼吸留白；用 `cellPixel` 响应式计算，
 *    窄屏 cell 缩小时环同步缩小（不能写死 px）。
 */

import { computed } from 'vue'

import { useGCS } from '@/shared'

import {
  EMPTY_TASK_INDICATOR,
  getTaskIndicator,
  type TaskIndicatorState,
  taskIndicatorVersion,
} from '../taskIndicator'

import GCSButton from './GCSButton.vue'
import TaskProgressRing from './TaskProgressRing.vue'

interface Props {
  label?: string
  icon?: string
  disabled?: boolean
  active?: boolean
  /** 关联路由路径：提供时显示任务进度环（v4-S6） */
  taskRoute?: string
}

const props = withDefaults(defineProps<Props>(), {
  label: '',
  icon: '',
  disabled: false,
  active: false,
  taskRoute: '',
})

defineEmits<{ click: [] }>()

const { cellPixel } = useGCS()

/**
 * 任务指示态：由 taskIndicator 注入的取值函数提供。
 * core 不引 stores（L3）——这里只调用注入进来的函数。
 *
 * 响应式靠 `taskIndicatorVersion`：注入方数据变化时递增该计数，
 * 本组件读它建立依赖并重算，避免把 Pinia 实例拖进 core。
 */
const indicator = computed<TaskIndicatorState>(() => {
  // 显式读版本号建立依赖（否则 computed 不会因外部数据变化重算）
  void taskIndicatorVersion.value
  if (!props.taskRoute) return EMPTY_TASK_INDICATOR
  return getTaskIndicator(props.taskRoute)
})

/**
 * 环显隐口径（用户 2026-09-19 定稿）：
 *
 * 「停靠中就保留」—— 只要有任务（含终态）就显示环，**不因用户人在该页而隐藏**。
 *
 * 为什么不做「人在该页就隐藏」：`docked` 表达的是任务让位排队，用户可能
 * 回到该路由但还没让任务跑完；环是唯一的跨页状态指示，隐藏会造成状态黑洞。
 * 任务跑完变绿/红后一直保留，直到下次提交覆盖。
 */
const showRing = computed(() => !!props.taskRoute && indicator.value.occupied)

/** 环直径（px）：按钮边长(0.8 cell) + 两侧各留 4px 呼吸间隙 */
const ringSize = computed(() => Math.round(cellPixel.value * 0.8 + 8))

/** 按钮边长（px），用于把环绝对定位居中覆盖按钮 */
const buttonSize = computed(() => Math.round(cellPixel.value * 0.8))
</script>

<template>
  <div class="nav-button-wrap" :style="{ width: `${buttonSize}px`, height: `${buttonSize}px` }">
    <GCSButton
      :w="0.8"
      :h="0.8"
      :label="label"
      :icon="icon"
      :disabled="disabled"
      :active="active"
      @click="$emit('click')"
    />

    <!--
      进度环：绝对定位居中、覆盖按钮四周。
      pointer-events:none ⇒ 绝不拦截点击（硬约束 ①）；
      不占流式布局 ⇒ 按钮尺寸零变化（硬约束 ②）。
    -->
    <span v-if="showRing" class="nav-button-ring">
      <TaskProgressRing
        :size="ringSize"
        :progress="indicator.progress"
        :status="indicator.status ?? 'pending'"
      />
    </span>
  </div>
</template>

<style scoped>
.nav-button-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* 环以按钮中心为锚点向外扩，靠绝对定位居中（负偏移 = 单侧留白） */
.nav-button-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;

  /* 🔴 不拦截点击：环是纯视觉反馈层 */
  pointer-events: none;
}
</style>
