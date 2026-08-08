<script setup lang="ts">
/**
 * GCSToast - 全局轻提示（GCS 标准，编程式）
 * 规格（用户定）：2cell 宽 × 1cell 高，语义色轻提示（success/warning/error），自动消失。
 * 由 App.vue 挂载一次，全局通过 showToast(message, type) 触发（gcsFeedback 单例），
 * 替换 Element Plus ElMessage。
 */
import { onBeforeUnmount, watch } from 'vue'

import { useGCS } from '@/shared/layout/useGCS'
import { gcsToastState } from '@/shared/utils/gcsFeedback'

const { cell } = useGCS()

const TOAST_DURATION_MS = 3000
const timers = new Map<number, ReturnType<typeof setTimeout>>()

// 新 toast 入队 → 启动自动消失计时
watch(
  () => gcsToastState.items.length,
  () => {
    for (const item of gcsToastState.items) {
      if (timers.has(item.id)) continue
      timers.set(
        item.id,
        setTimeout(() => {
          const idx = gcsToastState.items.findIndex((t) => t.id === item.id)
          if (idx !== -1) gcsToastState.items.splice(idx, 1)
          timers.delete(item.id)
        }, TOAST_DURATION_MS)
      )
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
})
</script>

<template>
  <div class="GCS-toast-container">
    <TransitionGroup name="GCS-toast">
      <div
        v-for="item in gcsToastState.items"
        :key="item.id"
        class="GCS-toast"
        :class="`GCS-toast--${item.type}`"
        :style="cell(2, 1)"
      >
        <span class="GCS-toast-dot" />
        <span class="GCS-toast-message">{{ item.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.GCS-toast-container {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1100;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}

.GCS-toast {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--GCS-bg-panel-translucent);
  border-radius: calc(var(--GCS-cell, 80px) * 0.15);
  box-shadow: var(--GCS-shadow-md);
  font-size: calc(var(--GCS-cell, 80px) * 0.16);
  color: var(--GCS-text-primary);
  padding: 0 16px;
  box-sizing: border-box;
  pointer-events: auto;
}

.GCS-toast-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.GCS-toast--success .GCS-toast-dot {
  background: var(--GCS-color-success);
}
.GCS-toast--warning .GCS-toast-dot {
  background: var(--GCS-color-warning);
}
.GCS-toast--error .GCS-toast-dot {
  background: var(--GCS-color-error);
}

.GCS-toast-message {
  line-height: 1.4;
}

/* 进出场动画 */
.GCS-toast-enter-active,
.GCS-toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.GCS-toast-enter-from,
.GCS-toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
