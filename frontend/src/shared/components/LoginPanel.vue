<script setup lang="ts">
/**
 * LoginPanel - 登录/注册面板（4×8 Cell）
 *
 * 布局规格：
 * - 顶部：标题 "个人主页"（1×0.5 Cell）
 * - 第2行：登录/注册按钮并排（各 1.8×0.8 Cell，中间留 0.4 Cell 间隙）
 * - 中间区域：用户名/密码输入框 + 错误提示 + 提交按钮
 * - 底部：退出登录按钮（3.8×0.8 Cell）
 *
 * 功能：复用 useAuth 的登录/注册/登出逻辑，默认显示登录表单。
 */

import { computed, ref } from 'vue'

import { useGCS } from '@/core/layout/useGCS.js'
import { useAuth } from '@/shared/composables/useAuth'

const { login, register, logout, user } = useAuth()
const { cellPixel, css } = useGCS()
// 解构出 CSS 变量供 v-bind() 使用
const { cell16px } = css

const mode = ref('login') // 'login' | 'register'
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const loading = ref(false)

// CSS v-bind 计算属性（使用响应式 cellPixel，随视口变化）
const panelPaddingCss = computed(() => `${cellPixel.value * 0.125}px`) // 10px
const titleFontSizeCss = computed(() => `${cellPixel.value * 0.225}px`) // 18px
const inputFontSizeCss = computed(() => `${cellPixel.value * 0.175}px`) // 14px
const btnFontSizeCss = computed(() => `${cellPixel.value * 0.175}px`) // 14px
const errorFontSizeCss = computed(() => `${cellPixel.value * 0.15}px`) // 12px
const avatarFontSizeCss = computed(() => `${cellPixel.value * 0.6}px`) // 48px = 0.6cell
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
    // 密码强度增强 - 至少包含大小写字母和数字
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
    // 密码不再 HTML 转义，原样传输（后端 bcrypt 处理，转义无安全收益）
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
    // 错误信息白名单过滤，防止反射型 XSS
    const rawMsg = (err as Error).message || '操作失败'
    errorMsg.value = rawMsg.replace(/[<>"'%;()&+]/g, '')
  } finally {
    loading.value = false
  }
}

async function handleLogout() {
  await logout()
  mode.value = 'login'
  username.value = ''
  password.value = ''
  confirmPassword.value = ''
}
</script>

<template>
  <div class="login-panel">
    <!-- 未登录状态：登录/注册表单 -->
    <template v-if="!user">
      <!-- 登录/注册切换按钮（1.8×0.8 Cell 并排） -->
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
    </template>

    <!-- 已登录状态：用户信息 -->
    <template v-else>
      <div class="user-info-area">
        <div class="avatar-icon"></div>
        <div class="user-name">{{ user.username }}</div>
        <div class="user-status">已登录</div>
      </div>
      <!-- 复用已有 handleLogout 与 .logout-btn 样式，补登出途径 -->
      <button class="logout-btn" @click="handleLogout">退出登录</button>
    </template>
  </div>
</template>

<style scoped>
.login-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: v-bind(panelPaddingCss);
  box-sizing: border-box;
  gap: v-bind(panelPaddingCss);
}

/* 登录/注册切换按钮（1.8×0.8 Cell） */
.mode-buttons {
  display: flex;
  gap: 10px; /* 非8的整数倍，保留 */
  justify-content: center;
}

.mode-btn {
  width: v-bind(modeBtnWidthCss);
  height: v-bind(modeBtnHeightCss);
  border: 1px solid var(--gcs-border-default);
  border-radius: var(--gcs-radius-md);
  background: var(--gcs-bg-panel);
  font-size: v-bind(btnFontSizeCss);
  color: var(--gcs-text-regular);
  cursor: pointer;
  transition: all 0.2s ease;
}

.mode-btn:hover {
  border-color: var(--gcs-color-primary);
  background: var(--gcs-bg-hover);
}

.mode-btn.active {
  background: var(--gcs-color-primary);
  color: var(--gcs-text-inverse);
  border-color: var(--gcs-color-primary);
}

/* 表单区域 */
.form-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px; /* 非8的整数倍，保留 */
  justify-content: flex-start;
  align-items: center;
}

.form-input {
  width: v-bind(formWidthCss);
  height: v-bind(formHeightCss);
  padding: 0 12px; /* 12px 非8的整数倍，保留 */
  border: 1px solid var(--gcs-border-default);
  border-radius: var(--gcs-radius-md);
  font-size: v-bind(inputFontSizeCss);
  color: var(--gcs-text-regular);
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.2s ease;
}

.form-input:focus {
  border-color: var(--gcs-color-primary);
}

.form-input::placeholder {
  color: var(--gcs-text-muted);
}

.error-text {
  font-size: v-bind(errorFontSizeCss);
  color: var(--gcs-color-error);
  text-align: center;
  margin: 4px 0;
}

.submit-btn {
  width: v-bind(formWidthCss);
  height: v-bind(formHeightCss);
  border: none;
  border-radius: var(--gcs-radius-md);
  background: var(--gcs-color-primary);
  color: var(--gcs-text-inverse);
  font-size: v-bind(btnFontSizeCss);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.submit-btn:hover:not(:disabled) {
  background: var(--gcs-color-primary-hover);
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 用户信息区域 */
.user-info-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: v-bind(cell16px);
}

.avatar-icon {
  font-size: v-bind(avatarFontSizeCss); /* 48px = 0.6cell */
  line-height: 1;
}

.user-name {
  font-size: v-bind(titleFontSizeCss);
  font-weight: 600;
  color: var(--gcs-text-primary);
}

.user-status {
  font-size: v-bind(errorFontSizeCss);
  color: var(--gcs-color-success);
}

/* 退出登录按钮（3.8×0.8 Cell） */
.logout-btn {
  width: v-bind(formWidthCss);
  height: v-bind(formHeightCss);
  border: 1px solid var(--gcs-color-error);
  border-radius: var(--gcs-radius-md);
  background: var(--gcs-bg-panel);
  color: var(--gcs-color-error);
  font-size: v-bind(btnFontSizeCss);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: auto;
  align-self: center;
}

.logout-btn:hover {
  background: var(--gcs-color-error);
  color: var(--gcs-text-inverse);
}
</style>
