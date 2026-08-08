<script setup lang="ts">
/**
 * GCSModal - 全局确认/提示弹窗（GCS 标准，编程式）
 * 规格（用户定）：
 * - 宽 4cell 高 3cell，居中
 * - 顶部右上角：× 关闭键
 * - 底部两个 1.8×0.8 cell 按钮：主按钮（按 mode：重试/去登录/确定）+ 取消
 * 三种模式：
 * - error：主按钮"重试"（onConfirm 由调用方传入）
 * - login：主按钮"去登录"（跳 /profile）
 * - confirm：主按钮"确定"（onConfirm 必传）
 * 由 App.vue 挂载一次，全局通过 showModal()/closeModal()/confirmModal() 编程式触发
 * （gcsFeedback 单例），替换 Element Plus ElMessageBox.confirm。
 */
import { useRouter } from 'vue-router'

import { useGCS } from '@/shared/layout/useGCS'
import { closeModal, confirmModal, gcsModalState } from '@/shared/utils/gcsFeedback'

const router = useRouter()
const { panelPosition } = useGCS()

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
      <div class="GCS-modal-panel" :style="panelPosition(4, 3, 'top-center', 0, 3)">
        <!-- 右上角关闭键 -->
        <button class="GCS-modal-close" aria-label="关闭" @click="handleClose">×</button>

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

        <!-- 底部按钮组：主按钮（1.8×0.8 cell）+ 取消（1.8×0.8 cell） -->
        <div class="GCS-modal-actions">
          <button class="GCS-btn GCS-btn-primary" @click="handleMainAction">
            {{ gcsModalState.confirmText }}
          </button>
          <button class="GCS-btn GCS-btn-cancel" @click="handleClose">取消</button>
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
  position: absolute;
  background: var(--GCS-bg-panel-translucent);
  border-radius: var(--GCS-radius-lg);
  box-shadow: var(--GCS-shadow-md);
  padding: 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
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
  gap: 8px;
  margin-top: auto;
}

/* 按钮：1.8 × 0.8 cell（GCS 规格） */
.GCS-btn {
  width: calc(var(--GCS-cell, 80px) * 1.8);
  height: calc(var(--GCS-cell, 80px) * 0.8);
  border: none;
  border-radius: calc(var(--GCS-cell, 80px) * 0.15);
  font-size: calc(var(--GCS-cell, 80px) * 0.18);
  cursor: pointer;
  transition: filter 0.15s;
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
