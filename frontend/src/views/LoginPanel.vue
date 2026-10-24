<script setup lang="ts">
/**
 * LoginPanel - 登录/注册表单面板
 * 顶部登录/注册切换按钮；登录态含用户名+密码，注册态追加确认密码。
 * 已登录态由父级（ProfilePage v-if="!user"）控制，本组件不处理。
 * 错误反馈一律走全局 toast（GCS 反馈层），不在组件内联渲染（不挤占表单布局）；
 * 文案按成因逐条细分，不笼统化：
 * - 账号空 →「请输入用户名」；密码空 →「请输入密码」（分开提示，不合并报）
 * - 账号不存在（后端 bizCode 401002）→「账号不存在，请先注册」+ 就地切注册模式并保留已输账号
 * - 密码错误（后端 bizCode 401003）→「密码错误」
 * - 后端不可达（NETWORK_ERROR/TIMEOUT）→「服务器无响应」（经 describeError，不往「登录」上引）
 */

import { ref } from 'vue'

import { ApiError, AUTH_BIZ_CODE, describeError, showToast, useAuth, useGCS } from '@/shared'

// AUTH_BIZ_CODE 收口 shared/constants/bizCodes.ts（与后端 ErrorCode 由 constants-audit 双侧断言，
// 组件内手抄数字曾有的漂移风险消除）

const { login, register } = useAuth()
const { cellCss, css } = useGCS()
const { cell8px, cell16px } = css

const mode = ref('login') // 'login' | 'register'
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const loading = ref(false)

// CSS v-bind 计算属性（响应式 cellPixel，随视口变化）
// 像素值统一经 useGCS().cellCss 派生（同公式曾在表单控件/按钮各处手抄）
// 表单控件字号统一 0.175 Cell（14px）
const controlFontSizeCss = cellCss(0.175) // 14px
// 1.8×0.8 Cell 按钮尺寸
const modeBtnWidthCss = cellCss(1.8) // 144px
const modeBtnHeightCss = cellCss(0.8) // 64px
// 3.8×0.8 Cell 表单控件尺寸（输入框 + 提交按钮 + 退出按钮）
const formWidthCss = cellCss(3.8) // 304px
const formHeightCss = cellCss(0.8) // 64px

function switchMode(m: string) {
  mode.value = m
  confirmPassword.value = ''
}

async function handleSubmit() {
  const trimmedUsername = username.value.trim()

  // 校验规则按顺序表驱动：空值分校验分开报（缺哪个报哪个），文案逐字不变。
  // ⚠️ 09-11 双轨消除：用户名/密码的**字符集与强度**规则已从本文件删除，权威判据在
  // backend auth.dto.ts（USERNAME_REGEX / PASSWORD_REGEX），由其 400001 文案回传展示。
  // 保留的仅是本端可判且不需要服务端知识的两条：最小长度（即时反馈）与两次一致（纯前端）。
  const checks: Array<{ when: () => boolean; message: string }> = [
    { when: () => trimmedUsername === '', message: '请输入用户名' },
    { when: () => password.value === '', message: '请输入密码' },
    {
      when: () => trimmedUsername.length < 2 || trimmedUsername.length > 20,
      message: '用户名长度须为 2-20 个字符',
    },
    ...(mode.value === 'register'
      ? [
          { when: () => password.value.length < 6, message: '密码长度不能少于 6 位' },
          { when: () => confirmPassword.value === '', message: '请输入确认密码' },
          { when: () => password.value !== confirmPassword.value, message: '两次密码输入不一致' },
        ]
      : []),
  ]
  const failed = checks.find((c) => c.when())
  if (failed) {
    showToast(failed.message, 'warning')
    return
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
    // 账号不存在（401002）：提示先注册，并就地切到注册模式、保留已输入的账号名
    if (
      mode.value === 'login' &&
      err instanceof ApiError &&
      err.bizCode === AUTH_BIZ_CODE.USER_NOT_FOUND
    ) {
      showToast('账号不存在，请先注册', 'warning')
      password.value = ''
      confirmPassword.value = ''
      mode.value = 'register'
      return
    }
    // 其余按成因透传：密码错误（后端文案）/服务器无响应（describeError）等，不笼统化
    showToast(describeError(err, '操作失败，请稍后重试'), 'error')
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
        :placeholder="mode === 'register' ? '至少6位，含大小写字母和数字' : '密码'"
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

      <!-- 错误反馈已收敛到全局 toast（GCS 反馈层），不在表单内联渲染 -->

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
  font-size: v-bind(controlFontSizeCss);
  color: var(--GCS-text-regular);
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
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

  /* 背景走 token：暗色模式下原生 input 默认白底会刺眼 */
  background: var(--GCS-bg-container);
  font-size: v-bind(controlFontSizeCss);
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

.submit-btn {
  width: v-bind(formWidthCss);
  height: v-bind(formHeightCss);
  border: none;
  border-radius: var(--GCS-radius-md);
  background: var(--GCS-color-primary);
  color: var(--GCS-text-inverse);
  font-size: v-bind(controlFontSizeCss);
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.submit-btn:hover:not(:disabled) {
  background: var(--GCS-color-primary-hover);
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
