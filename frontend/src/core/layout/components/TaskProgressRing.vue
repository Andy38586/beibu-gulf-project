<script setup lang="ts">
/**
 * TaskProgressRing — 任务进度环（v4-S6）
 *
 * 挂在导航按钮旁的环，表达「这个路由有个任务在后台跑」。
 *
 * ## 三个硬参数（口径 #4）
 *
 * - `stroke-width` **恒为 3**，不随进度/尺寸变化——线粗细变化会让环"跳动"，
 *   视觉上像在抖，反而比不显示进度更糟。
 * - `stroke-dasharray = 119.38`（2π × 19，r=19 的周长）。
 * - `stroke-dashoffset = 119.38 × (1 − p)`。
 *
 * ## 进度是阶段式的，不是真百分比
 *
 * 后端 `progress` 只有 0 → 0.1 → 1 三档（底层 `await postgis()` 无可切分点）。
 * 所以环只表达「有进展」：`running` 时用呼吸动画（opacity 1 ↔ 0.4）代替平滑增长。
 * **不要为了好看去插值伪造中间值**——那是在编造系统并不知道的信息。
 */

import { computed } from 'vue'

import type { TaskStatus } from '@/types/task'

interface Props {
  /** 尺寸（px），默认 44（套在 0.8 cell 按钮上） */
  size?: number
  /** 进度 0~1 */
  progress?: number
  status?: TaskStatus
}

const props = withDefaults(defineProps<Props>(), {
  size: 44,
  progress: 0,
  status: 'pending',
})

/** 半径固定 19，随 size 缩放而非重算 dasharray（保持参数单一） */
const RADIUS = 19
const CIRCUMFERENCE = 2 * Math.PI * RADIUS // ≈ 119.3805

const viewBox = computed(() => {
  // 环 + stroke 需要的留白：半径 19 + 线宽 3 → 22 半径的方框
  return '0 0 44 44'
})

/** 🔴 线宽恒为 3 */
const STROKE_WIDTH = 3

const dashOffset = computed(() => {
  const p = Math.min(1, Math.max(0, props.progress))
  return CIRCUMFERENCE * (1 - p)
})

/** 状态 → 颜色（消费既有 token，不新增色值） */
const ringColor = computed(() => {
  switch (props.status) {
    case 'done':
      return 'var(--GCS-color-success)'
    case 'failed':
      return 'var(--GCS-color-danger)'
    case 'cancelled':
      return 'var(--GCS-text-secondary)'
    default:
      // pending / running / retrying
      return 'var(--GCS-color-primary)'
  }
})

/** 呼吸动画只在活跃态启用（完成后静止，失败后静止——静止本身是信息） */
const isBreathing = computed(
  () => props.status === 'pending' || props.status === 'running' || props.status === 'retrying'
)

const sizeStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
}))
</script>

<template>
  <svg
    class="task-progress-ring"
    :class="{ 'is-breathing': isBreathing }"
    :style="sizeStyle"
    :viewBox="viewBox"
    role="img"
    :aria-label="`任务进行中，进度 ${Math.round(progress * 100)}%`"
  >
    <!-- 轨道：常驻底环，保证低进度时也看得出"这是个环" -->
    <circle
      class="task-progress-ring__track"
      cx="22"
      cy="22"
      :r="RADIUS"
      fill="none"
      :stroke-width="STROKE_WIDTH"
    />
    <!-- 进度弧：起点转到 12 点方向（rotate -90） -->
    <circle
      class="task-progress-ring__bar"
      cx="22"
      cy="22"
      :r="RADIUS"
      fill="none"
      :stroke="ringColor"
      :stroke-width="STROKE_WIDTH"
      :stroke-dasharray="CIRCUMFERENCE"
      :stroke-dashoffset="dashOffset"
      stroke-linecap="round"
      transform="rotate(-90 22 22)"
    />
  </svg>
</template>

<style scoped>
.task-progress-ring {
  display: block;
  pointer-events: none;
}

.task-progress-ring__track {
  stroke: var(--GCS-border-light);
}

/* 呼吸：透明度渐变（口径 #4：不做线宽动画，线宽恒定） */
.task-progress-ring.is-breathing {
  animation: task-ring-breathe 1.4s ease-in-out infinite;
}

@keyframes task-ring-breathe {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.4;
  }
}

/* 无障碍：减弱动效时不呼吸，环仍显示（信息不丢） */
@media (prefers-reduced-motion: reduce) {
  .task-progress-ring.is-breathing {
    animation: none;
  }
}
</style>
