<script setup lang="ts">
/**
 * GCSModal — 全局确认/提示弹窗（GCS 标准，编程式）：4×3 cell 居中，
 * 三种模式（error 重试 / login 去登录 / confirm 确定）。
 * App.vue 挂载一次，经 showModal()/closeModal()/confirmModal() 触发（gcsFeedback 单例），
 * 替代 Element Plus ElMessageBox.confirm。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { useGCS } from '@/shared/layout/useGCS'
import { closeModal, confirmModal, gcsModalState } from '@/shared/utils/gcsFeedback'

const router = useRouter()
const { cellPixel } = useGCS()

// cellPixel 随视口缩放（手机可至 60px），modal 保底 80px 以免缩到不可用
const MIN_CELL_PIXEL = 80
const effCell = computed(() => Math.max(cellPixel.value, MIN_CELL_PIXEL))

// 面板 4×3 cell：作为 overlay flex 容器子项居中，不设 padding——按钮间距全部由内部 margin 精确控制
const panelStyle = computed(() => ({
  width: `${4 * effCell.value}px`,
  height: `${3 * effCell.value}px`,
}))

// 按钮规格（用户定）：1.8×0.8 cell + 0.1cell 内边距（内容区实际 1.6×0.6）
const btnStyle = computed(() => ({
  width: `${1.8 * effCell.value}px`,
  height: `${0.8 * effCell.value}px`,
  padding: `${0.1 * effCell.value}px`,
}))
const actionsStyle = computed(() => ({
  gap: `${0.2 * effCell.value}px`, // 0.2cell 按钮间距
  marginBottom: `${0.1 * effCell.value}px`, // 距面板底部 0.1cell（panel 无 padding，不叠加）
}))

function handleClose(): void {
  closeModal()
}

function handleMainAction(): void {
  if (gcsModalState.mode === 'login') {
    // 去登录：关弹窗 + 跳个人中心（登录页）
    closeModal()
    void router.push('/profile')
    return
  }
  confirmModal()
}
</script>

<template>
  <Transition name="GCS-fade">
    <div v-if="gcsModalState.visible" class="GCS-modal-overlay" @click.self="handleClose">
      <div class="GCS-modal-panel" :style="panelStyle">
        <!-- 右上角关闭键 -->
        <button class="GCS-modal-close" aria-label="关闭" @click="handleClose">×</button>

        <!-- 内容区：图标 + 文字，在按钮上方的剩余空间内垂直水平居中 -->
        <div class="GCS-modal-content">
          <!-- 错误图标 -->
          <div class="GCS-modal-icon">
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

          <!-- 提示信息 -->
          <p class="GCS-modal-message">{{ gcsModalState.message }}</p>
        </div>

        <!-- 底部按钮组：主按钮（1.8×0.8 cell，0.1cell 内边距）+ 取消，间距 0.2cell -->
        <div class="GCS-modal-actions" :style="actionsStyle">
          <button class="GCS-btn GCS-btn-primary" :style="btnStyle" @click="handleMainAction">
            {{ gcsModalState.confirmText }}
          </button>
          <button class="GCS-btn GCS-btn-cancel" :style="btnStyle" @click="handleClose">
            取消
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.GCS-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--GCS-bg-overlay);
  backdrop-filter: blur(2px);
}

.GCS-modal-panel {
  /* 不设 position：作为 overlay flex 容器居中子项 */
  background: var(--GCS-bg-panel-translucent);
  border-radius: var(--GCS-radius-lg);
  box-shadow: var(--GCS-shadow-md);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* 内容区（图标+文字）：占据按钮上方的剩余空间，垂直水平居中 */
.GCS-modal-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 0;
}

.GCS-modal-close {
  position: absolute;
  top: 8px;
  right: 12px;
  border: none;
  background: transparent;
  font-size: 24px;
  line-height: 1;
  color: var(--GCS-text-secondary, #909399);
  cursor: pointer;
  padding: 4px;
}
.GCS-modal-close:hover {
  color: var(--GCS-text-primary);
}

.GCS-modal-icon {
  margin-top: 8px;
}

.GCS-modal-message {
  margin: 16px 0 20px;
  font-size: var(--GCS-font-size-body, 14px);
  color: var(--GCS-text-primary);
  text-align: center;
  line-height: 1.6;
  word-break: break-word;
}

.GCS-modal-actions {
  display: flex;
  margin-top: auto;
}

/* 按钮：1.8 × 0.8 cell（GCS 规格）——尺寸/内边距由 btnStyle 注入（响应式 cellPixel） */
.GCS-btn {
  border: none;
  border-radius: calc(var(--GCS-cell, 80px) * 0.15);
  font-size: calc(var(--GCS-cell, 80px) * 0.18);
  cursor: pointer;
  transition: filter 0.15s;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
}
.GCS-btn:hover {
  filter: brightness(0.95);
}
.GCS-btn-primary {
  background: var(--GCS-color-primary);
  color: var(--GCS-text-inverse, #fff);
}
.GCS-btn-cancel {
  background: var(--GCS-bg-panel);
  color: var(--GCS-text-regular);
  box-shadow: var(--GCS-shadow-sm);
}
</style>
