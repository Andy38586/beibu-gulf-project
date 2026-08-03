<script setup lang="ts">
/**
 * ErrorModal - 通用提示弹窗（模态弹窗，区别于 ElMessage 轻提示 / Toast）
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

// @audit-note DAT-4 预留未接入：当前无组件消费此通用弹窗，作为预留能力保留，请勿删除

import { useRouter } from 'vue-router'

import { useGCS } from '@/shared/layout/useGCS.js'

interface Props {
  visible?: boolean
  message?: string
  /** 弹窗模式：'error' 或 'login' */
  mode?: 'error' | 'login'
}

withDefaults(defineProps<Props>(), {
  visible: false,
  message: '网络异常，请重试',
  mode: 'error',
})

const emit = defineEmits<{
  close: []
  retry: []
}>()
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
    <div v-if="visible" class="error-modal-overlay" @click.self="handleClose">
      <div class="error-modal-panel" :style="panelPosition(4, 3, 'top-center', 0, 3)">
        <!-- 关闭按钮 -->
        <button class="close-btn" aria-label="关闭" @click="handleClose">×</button>

        <!-- 错误图标 -->
        <div class="error-icon">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="12" cy="12" r="10" stroke="var(--GCS-color-error)" stroke-width="2" />
            <path
              d="M12 8V13"
              stroke="var(--GCS-color-error)"
              stroke-width="2"
              stroke-linecap="round"
            />
            <circle cx="12" cy="16" r="1" fill="var(--GCS-color-error)" />
          </svg>
        </div>

        <!-- 错误信息 -->
        <p class="error-message">{{ message }}</p>

        <!-- 底部按钮组：两个并列按钮 -->
        <div class="button-group">
          <!-- 主按钮（蓝色）：重试 或 去登录 -->
          <button v-if="mode === 'login'" class="action-btn primary-btn" @click="handleLogin">
            去登录
          </button>
          <button v-else class="action-btn primary-btn" @click="handleRetry">重试</button>

          <!-- 次按钮（白色）：取消 -->
          <button class="action-btn cancel-btn" @click="handleClose">取消</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.error-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--GCS-bg-overlay);
  backdrop-filter: blur(2px);
}

.error-modal-panel {
  position: absolute;
  background: var(--GCS-bg-panel-translucent);
  border-radius: var(--GCS-radius-lg);
  box-shadow: var(--GCS-shadow-md);
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
  border-radius: var(--GCS-radius-sm);
  background: transparent;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: var(--GCS-text-muted);
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  background: var(--GCS-border-light);
  color: var(--GCS-text-regular);
}

.error-icon {
  font-size: 36px;
  line-height: 1;
}

.error-message {
  margin: 0;
  font-size: 15px;
  color: var(--GCS-text-primary);
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
  width: 144px;
  height: 64px;
  border: none;
  border-radius: var(--GCS-radius-md);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

/* 主按钮（蓝色）：重试/去登录 */
.primary-btn {
  background: var(--GCS-color-primary);
  color: var(--GCS-text-inverse);
}

.primary-btn:hover {
  background: var(--GCS-color-primary-hover);
}

.primary-btn:active {
  transform: scale(0.98);
}

/* 取消按钮（白色） */
.cancel-btn {
  background: var(--GCS-bg-elevated);
  color: var(--GCS-text-regular);
  border: 1px solid var(--GCS-border-default);
}

.cancel-btn:hover {
  border-color: var(--GCS-color-primary);
  background: var(--GCS-bg-hover);
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
