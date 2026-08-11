<script setup lang="ts">
/**
 * LoginPanel - 登录/注册表单面板
 * 顶部登录/注册切换按钮；登录态含用户名+密码，注册态追加确认密码。
 * 已登录态由父级（ProfilePage v-if="!user"）控制，本组件不处理。
 */

import { computed, ref } from 'vue'

import { useAuth } from '@/shared'
import { useGCS } from '@/shared'

const { login, register } = useAuth()
const { cellPixel, css } = useGCS()
const { cell8px, cell16px } = css

const mode = ref('login') // 'login' | 'register'
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const loading = ref(false)

// CSS v-bind 计算属性（响应式 cellPixel，随视口变化）
const inputFontSizeCss = computed(() => `${cellPixel.value * 0.175}px`) // 14px
const btnFontSizeCss = computed(() => `${cellPixel.value * 0.175}px`) // 14px
const errorFontSizeCss = computed(() => `${cellPixel.value * 0.15}px`) // 12px
// 1.8×0.8 Cell 按钮尺寸
const modeBtnWidthCss = computed(() => `${cellPixel.value * 1.8}px`) // 144px
const modeBtnHeightCss = computed(() => `${cellPixel.value * 0.8}px`) // 64px
// 3.8×0.8 Cell 表单控件尺寸（输入框 + 提交按钮 + 退出按钮）
const formWidthCss = computed(() => `${cellPixel.value * 3.8}px`) // 304px
const formHeightCss = computed(() => `${cellPixel.value * 0.8}px`) // 64px

function switchMode(m: string) {
  mode.value = m
  errorMsg.value = ''
  confirmPassword.value = ''
}

async function handleSubmit() {
  errorMsg.value = ''
  const trimmedUsername = username.value.trim()

  // 使用显式布尔转换
  if (username.value.trim() === '' || password.value === '') {
    errorMsg.value = '请填写用户名和密码'
    return
  }

  // 用户名长度校验（2-20 字符）
  if (trimmedUsername.length < 2 || trimmedUsername.length > 20) {
    errorMsg.value = '用户名长度应在 2-20 个字符之间'
    return
  }

  // 用户名特殊字符校验（仅允许字母、数字、中文、下划线）
  const usernameRegex = /^[\u4e00-\u9fa5a-zA-Z0-9_]+$/
  if (!usernameRegex.test(trimmedUsername)) {
    errorMsg.value = '用户名只能包含字母、数字、中文和下划线'
    return
  }

  if (mode.value === 'register') {
    if (password.value.length < 6) {
      errorMsg.value = '密码长度不能少于 6 位'
      return
    }
    // 密码强度：至少包含大小写字母和数字
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,}$/
    if (!passwordRegex.test(password.value)) {
      errorMsg.value = '密码必须包含大小写字母和数字'
      return
    }
    if (password.value !== confirmPassword.value) {
      errorMsg.value = '两次密码输入不一致'
      return
    }
  }
  loading.value = true
  try {
    // 密码原样传输：后端 bcrypt 处理，转义无安全收益
    if (mode.value === 'login') {
      await login(trimmedUsername, password.value)
    } else {
      await register(trimmedUsername, password.value)
    }
    // 成功后清空表单
    username.value = ''
    password.value = ''
    confirmPassword.value = ''
  } catch (err) {
    // 错误信息过滤，防反射型 XSS
    const rawMsg = (err as Error).message || '操作失败'
    errorMsg.value = rawMsg.replace(/[<>"'%;()&+]/g, '')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-panel">
    <!-- 登录/注册切换按钮（并排） -->
    <div class="mode-buttons">
      <button class="mode-btn" :class="{ active: mode === 'login' }" @click="switchMode('login')">
        登录
      </button>
      <button
        class="mode-btn"
        :class="{ active: mode === 'register' }"
        @click="switchMode('register')"
      >
        注册
      </button>
    </div>

    <!-- 表单区域 -->
    <div class="form-area">
      <input
        v-model="username"
        class="form-input"
        type="text"
        placeholder="用户名"
        autocomplete="username"
        @keydown.enter="handleSubmit"
      />
      <input
        v-model="password"
        class="form-input"
        type="password"
        placeholder="密码"
        autocomplete="current-password"
        @keydown.enter="handleSubmit"
      />
      <input
        v-if="mode === 'register'"
        v-model="confirmPassword"
        class="form-input"
        type="password"
        placeholder="确认密码"
        autocomplete="new-password"
        @keydown.enter="handleSubmit"
      />

      <!-- 错误提示 -->
      <div v-if="errorMsg" class="error-text">{{ errorMsg }}</div>

      <!-- 提交按钮 -->
      <button class="submit-btn" :disabled="loading" @click="handleSubmit">
        {{ loading ? '处理中...' : mode === 'login' ? '登录' : '注册' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.login-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: v-bind(cell8px);
  box-sizing: border-box;
  gap: v-bind(cell16px);
}

/* 登录/注册切换按钮（1.8×0.8 Cell），间距 0.2cell */
.mode-buttons {
  display: flex;
  gap: v-bind(cell16px);
  justify-content: center;
}

.mode-btn {
  width: v-bind(modeBtnWidthCss);
  height: v-bind(modeBtnHeightCss);
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-md);
  background: var(--GCS-bg-panel);
  font-size: v-bind(btnFontSizeCss);
  color: var(--GCS-text-regular);
  cursor: pointer;
  transition: all 0.2s ease;
}

.mode-btn:hover {
  border-color: var(--GCS-color-primary);
  background: var(--GCS-bg-hover);
}

.mode-btn.active {
  background: var(--GCS-color-primary);
  color: var(--GCS-text-inverse);
  border-color: var(--GCS-color-primary);
}

/* 表单区域 */
.form-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: v-bind(cell16px);
  justify-content: flex-start;
  align-items: center;
}

.form-input {
  width: v-bind(formWidthCss);
  height: v-bind(formHeightCss);
  padding: 0 12px; /* 12px 非8的整数倍，保留 */
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-md);
  font-size: v-bind(inputFontSizeCss);
  color: var(--GCS-text-regular);
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.2s ease;
}

.form-input:focus {
  border-color: var(--GCS-color-primary);
}

.form-input::placeholder {
  color: var(--GCS-text-muted);
}

.error-text {
  font-size: v-bind(errorFontSizeCss);
  color: var(--GCS-color-error);
  text-align: center;
  margin: 4px 0;
}

.submit-btn {
  width: v-bind(formWidthCss);
  height: v-bind(formHeightCss);
  border: none;
  border-radius: var(--GCS-radius-md);
  background: var(--GCS-color-primary);
  color: var(--GCS-text-inverse);
  font-size: v-bind(btnFontSizeCss);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.submit-btn:hover:not(:disabled) {
  background: var(--GCS-color-primary-hover);
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
