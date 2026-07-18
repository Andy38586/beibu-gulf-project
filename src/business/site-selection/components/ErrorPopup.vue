<script setup>
/**
 * ErrorPopup - 通用提示弹窗
 *
 * 规格：4×3 Cell 面板，居中显示
 * - 右上角：关闭按钮（×）
 * - 内容区：提示信息
 * - 底部：两个并列按钮
 *   - 主按钮（蓝色，1.8×0.8 cell）：重试 或 去登录
 *   - 次按钮（白色，1.8×0.8 cell）：取消
 *
 * 两种模式：
 * - mode='error'：显示"重试"和"取消"按钮
 * - mode='login'：显示"去登录"和"取消"按钮
 */

import { useGCS } from '@/core/layout/useGCS.js'
import { useRouter } from 'vue-router'

const props = defineProps({
  visible: { type: Boolean, default: false },
  message: { type: String, default: '网络异常，请重试' },
  /** 弹窗模式：'error' 或 'login' */
  mode: { type: String, default: 'error', validator: (v) => ['error', 'login'].includes(v) },
})

const emit = defineEmits(['close', 'retry'])
const router = useRouter()

const { panelPosition } = useGCS()

function handleClose() {
  emit('close')
}

function handleRetry() {
  emit('retry')
}

function handleLogin() {
  emit('close') // 先关闭弹窗
  router.push('/profile') // 跳转到登录页
}
</script>

<template>
  <Transition name="fade">
    <div v-if="visible" class="error-popup-overlay" @click.self="handleClose">
      <div class="error-popup-panel" :style="panelPosition(4, 3, 'top-center', 0, 3)">
        <!-- 关闭按钮 -->
        <button class="close-btn" @click="handleClose" aria-label="关闭">×</button>

        <!-- 错误图标 -->
        <div class="error-icon">⚠️</div>

        <!-- 错误信息 -->
        <p class="error-message">{{ message }}</p>

        <!-- 底部按钮组：两个并列按钮 -->
        <div class="button-group">
          <!-- 主按钮（蓝色）：重试 或 去登录 -->
          <button
            v-if="mode === 'login'"
            class="action-btn primary-btn"
            @click="handleLogin"
          >
            去登录
          </button>
          <button
            v-else
            class="action-btn primary-btn"
            @click="handleRetry"
          >
            重试
          </button>

          <!-- 次按钮（白色）：取消 -->
          <button class="action-btn cancel-btn" @click="handleClose">取消</button>
        </div>
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

/* 底部按钮组：两个并列按钮 */
.button-group {
  display: flex;
  gap: 12px;
  width: 100%;
  justify-content: center;
}

/* 操作按钮基础样式（1.8×0.8 cell 规格） */
.action-btn {
  width: 144px; /* 1.8 × 80px */
  height: 64px; /* 0.8 × 80px */
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

/* 主按钮（蓝色）：重试/去登录 */
.primary-btn {
  background: #409eff;
  color: #fff;
}

.primary-btn:hover {
  background: #66b1ff;
}

.primary-btn:active {
  transform: scale(0.98);
}

/* 取消按钮（白色） */
.cancel-btn {
  background: #ffffff;
  color: #333;
  border: 1px solid #e0e0e0;
}

.cancel-btn:hover {
  border-color: #409eff;
  background: #f0f7ff;
}

.cancel-btn:active {
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
