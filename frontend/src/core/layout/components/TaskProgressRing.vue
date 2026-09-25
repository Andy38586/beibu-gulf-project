<script setup lang="ts">
/**
 * TaskProgressRing — 任务进度环（v4-S6）
 *
 * 挂在导航按钮旁的**圆角矩形**框，表达「这个路由有个任务在后台跑」。
 *
 * ## 为什么是圆角矩形而不是圆
 *
 * 它套在 dock 按钮上，而按钮自身就是一个**带小圆角的方形**（`GCSButton.vue` 的
 * `buttonStyle`）—— 方形描出来才与它同形，画成正圆反而像个外来件。
 *
 * ⚠️ **环的圆角不取自按钮，也不取自任何 GCS 圆角 token** —— 按钮 rx 是 `cellPixel × 0.15`
 * 的行内计算（不消费 `--GCS-radius-*`），环 rx 是刻意恒定的一个值。两者是**两套口径**，
 * 不得互相引用为依据（04-H1）。详见下方 `RING_CORNER_PX`。
 *
 * ## 三个硬参数（口径 #4）
 *
 * - `stroke-width` **恒为 3**，不随进度/尺寸变化——线粗细变化会让环"跳动"，
 *   视觉上像在抖，反而比不显示进度更糟。
 * - 周长经 `pathLength="100"` 归一化 ⇒ `stroke-dasharray = 100`、
 *   `stroke-dashoffset = 100 × (1 − p)`。归一化后**不必手算圆角矩形的周长公式**
 *   （换形状时也不会因为公式写错而静默画错）。
 * - 圆角**渲染后恒为一个固定 px 值**，不随 `size` 也不随 `cellPixel` 变（靠 viewBox 反算得到，
 *   见下方 `RING_CORNER_PX`）。
 *
 * ## 进度是阶段式的，不是真百分比
 *
 * 后端 `progress` 只有 0 → 0.1 → 1 三档（底层 `await postgis()` 无可切分点）。
 * 所以框只表达「有进展」：`running` 时用呼吸动画（opacity 1 ↔ 0.4）代替平滑增长。
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

/**
 * 几何：外接方 38×38（= 原半径 19 的外接正方形），居中于 44×44 viewBox。
 * stroke 宽 3 ⇒ 描边跨中心线 ±1.5：框的**外缘在 1.5、内缘在 4.5**（viewBox 单位），
 * 四周各留 1.5 单位留白（外缘并不与 viewBox 边界重合）。
 */
const RECT_SIZE = 38
const RECT_ORIGIN = (44 - RECT_SIZE) / 2

/**
 * 环圆角：**刻意取恒定 12px**（经 viewBox 反算保证缩放到任意 `size` 后仍是 12px）。
 *
 * 为什么不跟按钮共用一套口径（这是本文件此前写错的地方）：按钮 rx = `cellPixel × 0.15`
 * （`GCSButton.vue` 的 `buttonStyle`，实测档位 70/80/90 ⇒ 10.5 / 12 / 13.5px），
 * 而环不读 `useGCS` —— 让它跟住 cellPixel 要把响应式档位引进这个纯 SVG 件，换来的只是
 * 三档里另外两档更贴合，默认档（cell 80）本来就重合 ⇒ 环取恒定值是刻意选定的口径。
 * ⇒ **环 rx 与按钮 rx 是两套口径，不得互相引用为依据**（04-H1）。
 *
 * 反算这一步必须保留：直接写 viewBox 坐标 `rx = 12` 会让渲染圆角随 size 等比放大
 * （size 72 时约 19.6px），那才是真的"浮在按钮上"。
 */
const RING_CORNER_PX = 12
const CORNER_RADIUS = computed(() => (RING_CORNER_PX * 44) / props.size)

const viewBox = computed(() => {
  // 框 + stroke 需要的留白：半宽 19 + 线宽 3 → 44 见方
  return '0 0 44 44'
})

/** 🔴 线宽恒为 3 */
const STROKE_WIDTH = 3

/** 周长经 `pathLength="100"` 归一化，故 offset 直接按百分比算，不必手算圆角矩形周长 */
const dashOffset = computed(() => {
  const p = Math.min(1, Math.max(0, props.progress))
  return 100 * (1 - p)
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
    <!-- 轨道：常驻底框，保证低进度时也看得出"这是个框" -->
    <rect
      class="task-progress-ring__track"
      :x="RECT_ORIGIN"
      :y="RECT_ORIGIN"
      :width="RECT_SIZE"
      :height="RECT_SIZE"
      :rx="CORNER_RADIUS"
      :ry="CORNER_RADIUS"
      fill="none"
      :stroke-width="STROKE_WIDTH"
    />
    <!-- 进度弧：自左上角圆角起点顺时针（SVG rect 路径的原生起笔处） -->
    <rect
      class="task-progress-ring__bar"
      :x="RECT_ORIGIN"
      :y="RECT_ORIGIN"
      :width="RECT_SIZE"
      :height="RECT_SIZE"
      :rx="CORNER_RADIUS"
      :ry="CORNER_RADIUS"
      fill="none"
      :stroke="ringColor"
      :stroke-width="STROKE_WIDTH"
      pathLength="100"
      stroke-dasharray="100"
      :stroke-dashoffset="dashOffset"
      stroke-linecap="round"
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
