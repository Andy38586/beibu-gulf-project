<script lang="ts">
export default { name: 'GCSTaskDropZone' }
</script>
<script setup lang="ts">
/**
 * TaskDropZone — 任务投递区（v4-S5，2026-09-19 改为不可见区）
 *
 * ## 它是什么
 *
 * 底部导航条上方的**透明投递区**：把主控制面板拖到这里松手 = 任务转后台运行。
 * 它是 `usePanelDrag` 的 `elementFromPoint` 命中目标（`data-task-dock-zone`）。
 *
 * ## 为什么是"不可见"（2026-09-19 用户定稿）
 *
 * 原实现是「后台任务」浮层卡片列表（TaskDockHost + TaskCard），
 * 用户明确否决：**不要另造一个承载物**，任务状态一律由导航按钮上的进度环表达。
 * 于是本组件退化为纯命中区：
 * - 常态：`pointer-events: none` + 完全透明，**不占视觉、不挡地图操作**。
 * - 拖拽中：显示一条虚线高亮提示（"松手转后台"），松手即恢复透明。
 *
 * ## 🔴 必须常驻渲染（这是第一次拖拽能成功的前提）
 *
 * 走 `v-if` 控显隐的话，不拖拽时元素不在 DOM ⇒ `elementFromPoint` 落空 ⇒
 * drop 永不触发（鸡生蛋死锁）。故本组件**永远渲染**，
 * 只靠 CSS 在"非拖拽"时彻底透明 + 不接收指针事件。
 */

import { computed } from 'vue'

/**
 * 拖拽期才显形的高亮。由上层注入全局拖拽态（App.vue ← useGlobalPanelDragActive）。
 */
interface Props {
  /** 是否有面板正在拖拽（拖拽期显示虚线提示） */
  dragActive?: boolean
  /** 指针是否悬停在本区上方（命中时加强高亮） */
  dropActive?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  dragActive: false,
  dropActive: false,
})

/** 显形条件：有人在拖（悬停中更强）——除此之外完全透明 */
const highlighted = computed(() => props.dragActive || props.dropActive)
</script>

<template>
  <div
    class="task-drop-zone"
    :class="{ 'is-highlighted': highlighted, 'is-hovered': dropActive }"
    :data-task-dock-zone="'task-dock'"
    role="region"
    aria-label="拖到此处让任务转入后台运行"
  >
    <span v-if="highlighted" class="task-drop-zone__hint">松手后该任务转为后台排队</span>
  </div>
</template>

<style scoped>
/*
 * 定位：贴底居中、位于底部导航条（1 cell = 80px）之上。
 * 用 bottom 而非 top：无论窗口多高都紧贴导航条，不依赖 cellPixel 计算。
 */
.task-drop-zone {
  position: absolute;
  bottom: calc(var(--GCS-cell, 80px) + 8px);
  left: 50%;
  transform: translateX(-50%);

  /*
   * 🔴 必须高于底部导航条（2026-09-19 实测修复）
   *
   * 原用 `--GCS-z-nav`（60），与 `BottomNavBar` 同档 ⇒ 同档时后者在 DOM 中靠后、
   * 绘制在上层，把投递区盖住。`elementFromPoint` 于是命中 `nav-inner` 而非投递区，
   * 导致**落在导航条上方那一片的松手全部投递失败**。
   * 投递区是拖拽期的临时浮层，取 panel-float 档（300）：高于导航条，
   * 又低于 drawer(400)/modal(500)，不会盖住真正的模态交互。
   */
  z-index: var(--GCS-z-panel-float);

  /*
   * 🔴 常态完全透明 + 不吃指针事件：
   * 投递区是"隐形靶子"，只在拖拽期靠 CSS 变可见。
   * 保留尺寸是为了 elementFromPoint 有稳定的命中范围。
   */
  min-width: min(320px, calc(100vw - 32px));

  /*
   * 高度：单行提示文案的高度，靠 padding 撑到 ~29px。
   *
   * 🔴 为什么不加更高（2026-09-19 评估后保留原值）：
   * 曾考虑把命中带加高以提升容错，但实测发现投递失败的真因是
   * **手柄污染 + z-index 被导航条盖住**（见下两处修复），而非带子太窄。
   * 29px 配合「指针进入即高亮」的判定已足够——拖拽时用户的注意力在
   * 高亮反馈上，而高亮本身是显眼的虚线框。
   * 加高反而会让投递区向上侵占地图可操作区（虽然 pointer-events:none
   * 不挡点击，但拖拽期它会盖住面板拖拽路径，造成视觉噪音）。
   */
  padding: 6px 12px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--GCS-radius-md);
  background: transparent;
  outline: 2px dashed transparent;
  outline-offset: 2px;
  pointer-events: none;
  transition:
    background-color 0.15s ease,
    outline-color 0.15s ease;
}

/* 拖拽中：虚线提示"可放这里"（此时才可见，不破"布局零变化"） */
.task-drop-zone.is-highlighted {
  background: var(--GCS-bg-panel-translucent, var(--GCS-bg-panel));
  outline-color: var(--GCS-color-primary);
}

/* 悬停命中：加实背景，给出"已对准"的确认 */
.task-drop-zone.is-hovered {
  background: var(--GCS-bg-panel);
}

.task-drop-zone__hint {
  font-size: var(--GCS-font-size-xs);
  color: var(--GCS-text-secondary);
  white-space: nowrap;
}

/* 低分辨率（<960px 抽屉模式）下收窄，避免碰到抽屉边缘 */
@media (width < 960px) {
  .task-drop-zone {
    min-width: calc(100vw - 24px);
  }
}
</style>
