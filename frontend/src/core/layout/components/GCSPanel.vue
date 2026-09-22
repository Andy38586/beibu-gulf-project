<script setup lang="ts">
/**
 * GCSPanel - GCS（网格化布局系统）Panel 容器
 * 位置与尺寸由 anchor + offset + w/h 经 PPS（面板定位系统）计算，
 * 统一视觉：圆角 = Cell × 0.15、白色实体背景 + 轻阴影。
 * Props：w/h 为 Cell（80px 网格单元）数（必填），anchor 锚点（默认 top-left），offsetX/Y 偏移（Cell 单位）。
 *
 * v4：新增 draggable（默认 false）。为 true 时面板头部可作为拖拽手柄，
 * 拖向底部 dock 投递区即"丢到后台"。默认关闭 ⇒ 现有面板行为零变化（L1）。
 */

import { computed, ref } from 'vue'

import { useGCS, usePanelDrag } from '@/shared'

interface Props {
  w: number
  h: number
  /** 锚点位置（联合字面量类型约束） */
  anchor?:
    | 'top-left'
    | 'top-right'
    | 'top-center'
    | 'bottom-center'
    | 'bottom-left'
    | 'bottom-right'
  offsetX?: number
  offsetY?: number
  /** 是否可拖拽（默认 false，R1：避免误伤全站） */
  draggable?: boolean
  /** 拖拽时是否锁定（如任务运行中不允许再次拖走） */
  dragDisabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  anchor: 'top-left',
  offsetX: 0,
  offsetY: 0,
  draggable: false,
  dragDisabled: false,
})

const emit = defineEmits<{
  /** 命中 dock 投递区 */
  drop: [zone: HTMLElement]
  /** 拖拽开始 */
  dragstart: []
  /** 拖拽结束（投递成功或回滚均触发） */
  dragend: []
}>()

const { panelPosition, cellPixel } = useGCS()

/** 拖拽期间挂在面板上的标记 class（供外部 :deep 覆盖视觉） */
const dragActive = ref(false)

const {
  phase,
  offsetX,
  offsetY,
  overZone,
  onPointerDown,
  abort: abortDrag,
} = usePanelDrag({
  enabled: () => props.draggable && !props.dragDisabled,
  // 输入框 / 按钮 / 可滚动区不启动拖拽（否则点输入框即被拖走）
  ignoreSelector: 'input, textarea, select, button, a, [data-no-drag], [contenteditable="true"]',
  onDragStart: () => {
    dragActive.value = true
    emit('dragstart')
  },
  onDrop: (zone) => emit('drop', zone),
  onDragEnd: () => {
    dragActive.value = false
    emit('dragend')
  },
})

const isDragging = computed(() => phase.value === 'dragging')

/**
 * 输出 CSS 变量而非内联定位属性，外部可用 :deep(.GCS-panel) 覆盖变量、无需 !important。
 * GCS 铁律：CSS 变量一律全大写 --GCS-* 前缀。
 * min-width/height 用响应式 cellPixel：窄屏面板等比缩小，避免实际宽度大于定位宽度而溢出。
 */
const panelStyle = computed(() => {
  const pos = panelPosition(props.w, props.h, props.anchor, props.offsetX, props.offsetY)
  const wPx = parseFloat(pos.width) || props.w * 80
  const hPx = parseFloat(pos.height) || props.h * 80
  const cell = cellPixel.value > 0 ? cellPixel.value : 80
  const style: Record<string, string> = {
    '--GCS-panel-left': pos.left || '20px',
    '--GCS-panel-top': pos.top || '20px',
    '--GCS-panel-width': `${wPx}px`,
    '--GCS-panel-height': `${hPx}px`,
    '--GCS-panel-min-width': `${props.w * cell}px`,
    '--GCS-panel-min-height': `${props.h * cell}px`,
  }
  // 拖拽期脱离 PPS：transform 跟随指针（不写 left/top，原定位值保留以便回滚）
  if (isDragging.value) {
    style['--GCS-panel-drag-transform'] = `translate3d(${offsetX.value}px, ${offsetY.value}px, 0)`
  }
  return style
})

defineExpose({ abortDrag })
</script>

<template>
  <div
    class="GCS-panel"
    :class="{
      'is-draggable': draggable && !dragDisabled,
      'is-dragging': isDragging,
      'is-over-zone': isDragging && overZone,
    }"
    :style="panelStyle"
  >
    <!-- 拖拽手柄：仅在 draggable 时渲染，覆盖面板顶部一条（不改变面板尺寸） -->
    <div
      v-if="draggable && !dragDisabled"
      class="GCS-panel__drag-handle"
      role="button"
      tabindex="0"
      aria-label="拖拽面板到底部停靠到后台"
      @pointerdown="onPointerDown"
    />
    <slot />
  </div>
</template>

<style scoped>
.GCS-panel {
  /* 定位属性消费 CSS 变量：外部可通过 :deep 覆盖而非 !important */
  position: absolute;
  left: var(--GCS-panel-left, 20px);
  top: var(--GCS-panel-top, 20px);
  width: var(--GCS-panel-width, 320px);
  height: var(--GCS-panel-height, 240px);
  min-width: var(--GCS-panel-min-width, 80px);
  min-height: var(--GCS-panel-min-height, 80px);
  border-radius: var(--GCS-radius-md);
  background-color: var(--GCS-bg-panel);
  box-shadow: var(--GCS-shadow-sm);
  box-sizing: border-box;
  overflow: hidden;
  pointer-events: auto;
  color: var(--GCS-text-regular);
}

/* ===== v4 拖拽（默认不生效，仅 draggable=true 时） ===== */

.GCS-panel.is-draggable {
  /* 手柄区域用 grab 光标提示可拖 */
  cursor: default;
}

/* 拖拽手柄：绝对定位覆盖顶部一条，不参与流式布局（面板内部尺寸零变化） */
.GCS-panel__drag-handle {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 16px;
  z-index: 2;
  cursor: grab;

  /* 透明但可命中：不用 background，避免改变既有视觉 */
  background: transparent;
  touch-action: none;
}

.GCS-panel__drag-handle:active {
  cursor: grabbing;
}

/* 手柄可聚焦（键盘可达性），但不显示焦点环的视觉干扰——沿用面板圆角 */
.GCS-panel__drag-handle:focus-visible {
  outline: 2px solid var(--GCS-border-focus);
  outline-offset: -2px;
}

.GCS-panel.is-dragging {
  /* 脱离 PPS 定位的位移：transform 由 CSS 变量驱动 */
  transform: var(--GCS-panel-drag-transform, none);
  z-index: var(--GCS-z-panel-float);
  opacity: 0.92;
  box-shadow: var(--GCS-shadow-md, var(--GCS-shadow-sm));

  /* 拖拽中面板不应拦截 elementFromPoint，否则永远命中自己、无法判定 dock */
  pointer-events: none;
  transition: none;
  will-change: transform;
}

/*
 * 🔴 拖拽期必须让**手柄**也失活（2026-09-19 实测修复）
 *
 * 父元素的 `pointer-events: none` **不作用于子元素**：手柄是独立的
 * `position:absolute` 子元素，且为了接收 pointerdown 自带 `pointer-events:auto`，
 * 于是拖拽期间它是唯一还能被 `elementFromPoint` 命中的元素。
 *
 * 症状（真实复现）：松手点恰好落在手柄的投影范围内时，`findDropZone()` 命中的是
 * 手柄而非投递区 ⇒ `onDrop` 不触发、静默回滚（无报错、无提示），
 * 表现为「拖过去了但什么都没发生」。而松手点在手柄之外时投递正常，
 * 所以这个 bug 是**位置相关**的、时隐时现、极易被误判为偶发。
 */
.GCS-panel.is-dragging .GCS-panel__drag-handle {
  pointer-events: none;
}

/* 悬停投递区时给出「可放下」的视觉反馈（不改变尺寸/圆角体系） */
.GCS-panel.is-over-zone {
  outline: 2px dashed var(--GCS-color-primary);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .GCS-panel.is-dragging {
    will-change: auto;
  }
}
</style>
