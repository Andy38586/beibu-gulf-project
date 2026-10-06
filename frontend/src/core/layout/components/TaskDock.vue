<script setup lang="ts">
/**
 * TaskDock — 后台任务卡片条（v4-S5 的可见层：任务转后台后"任务去了哪"的家）。
 *
 * 纯 UI 组件（core 不接 store，同 TaskDropZone 先例）：卡片数据由 App.vue 顶层
 * 从 taskStore 派生后以 props 供给。常驻贴导航条上方（--GCS-z-nav 档）；
 * 空态整体不渲染（L1：不加可见布局）。
 *
 * 卡片交互：点击 → 跳回该路由（面板在原位可用，语义见 TaskPanelSlot 09-19 修正）；
 * 运行中卡片带迷你进度弧（复用 --GCS-color-primary 呼吸语义）。
 */
import { computed } from 'vue'

export interface TaskDockCard {
  taskId: string
  route: string
  label: string
  icon: string
  status: 'pending' | 'running' | 'retrying' | 'done' | 'failed' | 'cancelled'
  progress: number
}

const props = defineProps<{ cards: TaskDockCard[] }>()

const emit = defineEmits<{ (e: 'open', route: string): void }>()

const STATUS_TEXT: Record<TaskDockCard['status'], string> = {
  pending: '排队中',
  running: '计算中',
  retrying: '重试中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const isActive = (s: TaskDockCard['status']): boolean =>
  s === 'pending' || s === 'running' || s === 'retrying'

const ordered = computed(() =>
  [...props.cards].sort((a, b) => Number(isActive(b.status)) - Number(isActive(a.status)))
)
</script>

<template>
  <div v-if="ordered.length" class="task-dock" data-task-dock-visible>
    <button
      v-for="card in ordered"
      :key="card.taskId"
      type="button"
      class="task-dock__card"
      :class="`is-${card.status}`"
      :title="`${card.label} — ${STATUS_TEXT[card.status]}（点击回到面板）`"
      @click="emit('open', card.route)"
    >
      <svg
        v-if="isActive(card.status)"
        class="task-dock__ring"
        viewBox="0 0 22 22"
        aria-hidden="true"
      >
        <circle class="ring-track" cx="11" cy="11" r="9" />
        <circle
          class="ring-bar"
          cx="11"
          cy="11"
          r="9"
          :stroke-dasharray="56.55"
          :stroke-dashoffset="56.55 * (1 - card.progress)"
        />
      </svg>
      <span v-else class="task-dock__dot" :class="`dot-${card.status}`" />
      <span class="task-dock__icon">{{ card.icon }}</span>
      <span class="task-dock__label">{{ card.label }}</span>
      <span class="task-dock__status">{{ STATUS_TEXT[card.status] }}</span>
    </button>
  </div>
</template>

<style scoped>
.task-dock {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(var(--GCS-cell, 80px) + 26px);
  display: flex;
  gap: 8px;
  z-index: var(--GCS-z-panel-float);
  pointer-events: auto;
}

.task-dock__card {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--GCS-border-default);
  border-radius: 8px;
  background: var(--GCS-bg-panel-translucent);
  cursor: pointer;
  font-size: 12px;
  color: var(--GCS-text-primary);
  box-shadow: var(--GCS-shadow-sm);
}

.task-dock__ring {
  width: 18px;
  height: 18px;
  flex: none;
}

.ring-track,
.ring-bar {
  fill: none;
  stroke-width: 3;
}

.ring-track {
  stroke: var(--GCS-border-default);
}

.ring-bar {
  stroke: var(--GCS-color-primary);
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: center;
}

.is-running .ring-bar,
.is-pending .ring-bar,
.is-retrying .ring-bar {
  animation: dock-breath 1.4s ease-in-out infinite;
}

@keyframes dock-breath {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.4;
  }
}

@media (prefers-reduced-motion: reduce) {
  .is-running .ring-bar,
  .is-pending .ring-bar,
  .is-retrying .ring-bar {
    animation: none;
  }
}

.task-dock__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.dot-done {
  background: var(--GCS-color-success);
}

.dot-failed {
  background: var(--GCS-color-danger);
}

.dot-cancelled {
  background: var(--GCS-text-muted);
}

.task-dock__icon {
  font-size: 13px;
}

.task-dock__label {
  font-weight: 600;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-dock__status {
  color: var(--GCS-text-muted);
  font-size: 11px;
}
</style>
