<script setup lang="ts">
/**
 * TaskPanelSlot — 可拖拽主控制面板的包装层（v4-S5/S7）
 *
 * ## 职责边界（2026-09-19 语义修正后）
 *
 * 它**只做两件事**，不碰任何业务逻辑：
 * 1. 给内层 `GCSPanel` 打开 `draggable`；
 * 2. 把「拖到了投递区」这件事上报给页面（页面去调 `taskStore`）。
 *
 * ## 🔴 为什么不再有「停靠态换占位条」的分支
 *
 * 原实现认为 `docked` = 面板收起，于是 docked 时把面板换成占位条。
 * **这是对语义的误解**（用户 2026-09-19 澄清）：
 *
 *   `docked` 表达的是「这个**任务**已让位到后台排队」，**不是面板消失**。
 *   面板是结果与控制的载体，必须始终在原位可用 —— 拖走的只是任务的执行优先级。
 *
 * 所以本组件**永远渲染内层面板**，`docked` 不参与渲染决策。
 * （`docked` 仍保留在 store 里：它是「用户主动让位过」的审计信息，
 *   且是导航环「停靠中保留」的判据。）
 *
 * ## 拖拽是否会重复提交
 *
 * 会。同路由重复拖拽 = 重新提交（后端 cancel 旧的）。这是可接受的：
 * 拖拽本身是显式用户动作，且 `submit` 内部有竞态守卫与旧任务让位逻辑。
 * 但**活跃任务期间禁用拖拽**（`dragLocked`），避免无意义的重提交。
 */

import { computed } from 'vue'

import type { TaskSlot } from '@/types/task'

import GCSPanel from './GCSPanel.vue'

interface Props {
  /** 面板宽（Cell） */
  w: number
  /** 面板高（Cell） */
  h: number
  anchor?:
    | 'top-left'
    | 'top-right'
    | 'top-center'
    | 'bottom-center'
    | 'bottom-left'
    | 'bottom-right'
  offsetX?: number
  offsetY?: number
  /** 面板名（拖拽无障碍标签用，如「水位控制」） */
  label?: string
  /**
   * 该路由的任务槽（null = 无任务）。
   *
   * 🔴 命名为 `taskSlot` 而非 `slot`：`slot` 是 Vue 保留属性，
   *    用作 prop 名会触发 `vue/no-deprecated-slot-attribute` 且语义混淆。
   */
  taskSlot?: TaskSlot | null
}

const props = withDefaults(defineProps<Props>(), {
  anchor: 'top-left',
  offsetX: 0,
  offsetY: 0,
  label: '控制面板',
  taskSlot: null,
})

const emit = defineEmits<{
  /** 面板被拖到投递区 ⇒ 页面调 taskStore 提交并 setDocked(true) */
  dock: []
}>()

/**
 * 拖拽是否被禁用：该路由已有**活跃**任务时不允许再拖。
 *
 * 理由：活跃任务 = 已在跑，再拖一次只会 cancel + 重建，纯浪费。
 * 终态任务允许再拖（重新计算），这正是"跑完想更新结果"的自然路径。
 */
const dragLocked = computed(() => {
  const s = props.taskSlot
  if (!s) return false
  return s.status === 'pending' || s.status === 'running' || s.status === 'retrying'
})
</script>

<template>
  <!--
    外壳与定位参数始终一致；面板内容永远渲染（语义见文件头注释）。
    不传 :draggable 表达式外的东西，保证 L1「布局零变化」。
  -->
  <GCSPanel
    :w="w"
    :h="h"
    :anchor="anchor"
    :offset-x="offsetX"
    :offset-y="offsetY"
    :draggable="true"
    :drag-disabled="dragLocked"
    class="task-panel-slot"
    @drop="emit('dock')"
  >
    <slot />
  </GCSPanel>
</template>

<style scoped>
.task-panel-slot {
  /* 无额外视觉：外壳完全沿用 GCSPanel 既有样式（L1 零改动） */
}
</style>
