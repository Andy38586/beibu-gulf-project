<script setup>
/**
 * ErrorPopup - 网络异常错误弹窗
 *
 * 规格：4×3 Cell 面板，居中显示
 * - 右上角：关闭按钮（×）
 * - 内容区：错误信息 + 重试按钮
 */

import { useGCS } from '@/core/layout/useGCS.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  message: { type: String, default: '网络异常，请重试' },
})

const emit = defineEmits(['close', 'retry'])

const { panelPosition } = useGCS()

function handleClose() {
  emit('close')
}

function handleRetry() {
  emit('retry')
}
</script>

<template>
  <Transition name="fade">
    <div v-if="visible" class="error-popup-overlay" @click.self="handleClose">
      <div class="error-popup-panel" :style="panelPosition(4, 3, 'top-center', 0, 3)">
        <!-- 关闭按钮 -->
        <button class="close-btn" @click="handleClose" aria-label="关闭">×</button>

        <!-- 错误图标 -->
        <div class="error-icon">️</div>

        <!-- 错误信息 -->
        <p class="error-message">{{ message }}</p>

        <!-- 重试按钮 -->
        <button class="retry-btn" @click="handleRetry">重试</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.error-popup-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(2px);
}

.error-popup-panel {
  position: absolute;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  padding: 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.close-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: #999;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  background: #f0f0f0;
  color: #333;
}

.error-icon {
  font-size: 36px;
  line-height: 1;
}

.error-message {
  margin: 0;
  font-size: 15px;
  color: #333;
  text-align: center;
  line-height: 1.5;
}

.retry-btn {
  width: 100%;
  height: 40px;
  border: none;
  border-radius: 8px;
  background: #409eff;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.retry-btn:hover {
  background: #66b1ff;
}

.retry-btn:active {
  transform: scale(0.98);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
