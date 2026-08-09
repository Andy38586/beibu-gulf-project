<script setup lang="ts">
/**
 * GCSToast - 全局轻提示（GCS 标准，编程式）
 * 规格（用户定）：2cell 宽 × 0.5cell 高（2026-08-08 用户调矮：原 1cell 太高），
 * 语义色轻提示（success/warning/error），自动消失。
 * 由 App.vue 挂载一次，全局通过 showToast(message, type) 触发（gcsFeedback 单例），
 * 替换 Element Plus ElMessage。
 */
import { onBeforeUnmount, watch } from 'vue'

import { useGCS } from '@/shared/layout/useGCS'
import { gcsToastState } from '@/shared/utils/gcsFeedback'

const { cell } = useGCS()

const TOAST_DURATION_MS = 3000
const timers = new Map<number, ReturnType<typeof setTimeout>>()

// 新 toast 入队 → 启动自动消失计时（3s 后原位淡出）
// 触发信号用 id 序列而非 items.length：队列满 4 时第 5 个来的 pop+unshift
// 长度 4→3→4 最终不变，watch length 不触发 → 新 toast 永远无定时器（08-09 修复）。
// 消失位置不限定：定时器到点后 splice(idx,1) 移除 toast 所在位置（1/2/3/4 位均可），
// TransitionGroup leave 动画与原位一致。
watch(
  () => gcsToastState.items.map((t) => t.id).join(','),
  () => {
    // 清理已被移除（pop 挤掉/已消失）toast 的残留定时器
    for (const id of timers.keys()) {
      if (!gcsToastState.items.some((t) => t.id === id)) {
        const timer = timers.get(id)
        if (timer) clearTimeout(timer)
        timers.delete(id)
      }
    }
    // 为尚无定时器的新 toast 启动 3s 计时
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
        :style="cell(2, 0.5)"
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
  /* 2026-08-08：不加 max-height/overflow 裁切——裁切会水平切断 toast 导致"变细"；
     队列上限由 gcsFeedback.showToast 控制（最多 4 条，第 5 条来最早的淡出） */
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

/* 进出场动画（新 toast 从顶部进入占一号位，老 toast 顺移下移用 move 过渡） */
.GCS-toast-enter-active,
.GCS-toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.GCS-toast-enter-from,
.GCS-toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
/* TransitionGroup 位置变化（老 toast 被挤到下一位）——平滑下移 */
.GCS-toast-move {
  transition: transform 0.2s ease;
}
</style>
