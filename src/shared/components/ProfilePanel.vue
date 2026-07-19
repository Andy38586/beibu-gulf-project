<script setup>
/**
 * ProfilePanel - 用户信息面板
 *
 * Phase 5-B：调整为适配 GCS Panel 的内联组件，供 ProfilePage 左侧使用。
 * 职责：用户登录/注册、用户信息展示、登出。
 */

import { ref, watch, computed } from 'vue'
import { useAuth } from '@/shared/composables/useAuth'
import { CELL_PIXEL } from '@/core/layout/config.js'

const props = defineProps({ visible: Boolean })
const emit = defineEmits(['close'])

const { login, register, logout, user } = useAuth()

const mode = ref('login')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const loading = ref(false)

watch(
  () => props.visible,
  (v) => {
    if (!v) {
      errorMsg.value = ''
    }
  },
)

function switchMode(m) {
  mode.value = m
  errorMsg.value = ''
  confirmPassword.value = ''
}

async function handleSubmit() {
  errorMsg.value = ''
  if (!username.value.trim() || !password.value) {
    errorMsg.value = '请填写用户名和密码'
    return
  }
  if (mode.value === 'register') {
    if (password.value.length < 6) {
      errorMsg.value = '密码长度不能少于 6 位'
      return
    }
    if (password.value !== confirmPassword.value) {
      errorMsg.value = '两次密码输入不一致'
      return
    }
  }
  loading.value = true
  try {
    if (mode.value === 'login') {
      await login(username.value.trim(), password.value)
    } else {
      await register(username.value.trim(), password.value)
    }
  } catch (err) {
    errorMsg.value = err.message
  } finally {
    loading.value = false
  }
}

async function handleLogout() {
  await logout()
  mode.value = 'login'
}

// 用于 CSS v-bind 的计算属性：基于 CELL_PIXEL 的比例计算
const avatarSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.6)}px`)
const avatarFontSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.3)}px`)
const headerPaddingCss = computed(() => `${Math.round(CELL_PIXEL * 0.15)}px`)
const headerFontSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.2)}px`)
const closeBtnFontSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.25)}px`)
const closeBtnPaddingCss = computed(() => `0 ${Math.round(CELL_PIXEL * 0.05)}px`)
const bodyPaddingCss = computed(() => `${Math.round(CELL_PIXEL * 0.15)}px`)
const tabMarginCss = computed(() => `${Math.round(CELL_PIXEL * 0.15)}px`)
const formGapCss = computed(() => `${Math.round(CELL_PIXEL * 0.125)}px`)
const errorFontSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.15)}px`)
const userInfoGapCss = computed(() => `${Math.round(CELL_PIXEL * 0.15)}px`)
const detailsGapCss = computed(() => `${Math.round(CELL_PIXEL * 0.05)}px`)
const userNameFontSizeCss = computed(() => `${Math.round(CELL_PIXEL * 0.2)}px`)
</script>

<template>
  <div class="profile-panel" v-if="visible">
    <div class="panel-header">
      <h3>{{ user ? '个人主页' : '登录/注册' }}</h3>
      <button type="button" class="close-btn" @click="emit('close')">×</button>
    </div>

    <div class="panel-body" v-if="!user">
      <el-tabs v-model="mode" class="tab-row" @tab-change="switchMode">
        <el-tab-pane label="登录" name="login">
          <el-form class="auth-form" @submit.prevent="handleSubmit">
            <el-input
              v-model="username"
              placeholder="用户名"
              autocomplete="username"
              size="small"
            />
            <el-input
              v-model="password"
              type="password"
              placeholder="密码"
              autocomplete="current-password"
              size="small"
            />
            <div v-if="errorMsg" class="error-text">{{ errorMsg }}</div>
            <el-button
              type="primary"
              size="small"
              class="submit-btn"
              :loading="loading"
              @click="handleSubmit"
            >
              {{ loading ? '处理中...' : '登录' }}
            </el-button>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="注册" name="register">
          <el-form class="auth-form" @submit.prevent="handleSubmit">
            <el-input
              v-model="username"
              placeholder="用户名"
              autocomplete="username"
              size="small"
            />
            <el-input
              v-model="password"
              type="password"
              placeholder="密码"
              autocomplete="current-password"
              size="small"
            />
            <el-input
              v-model="confirmPassword"
              type="password"
              placeholder="确认密码"
              autocomplete="new-password"
              size="small"
            />
            <div v-if="errorMsg" class="error-text">{{ errorMsg }}</div>
            <el-button
              type="primary"
              size="small"
              class="submit-btn"
              :loading="loading"
              @click="handleSubmit"
            >
              {{ loading ? '处理中...' : '注册' }}
            </el-button>
          </el-form>
        </el-tab-pane>
      </el-tabs>
    </div>

    <div class="panel-body" v-else>
      <div class="user-info">
        <div class="avatar">👤</div>
        <div class="user-details">
          <span class="user-name">{{ user.username }}</span>
          <el-button size="small" @click="handleLogout">退出</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.panel-header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  padding-bottom: v-bind(headerPaddingCss);
}
.panel-header h3 {
  margin: 0;
  font-size: v-bind(headerFontSizeCss);
  color: #fff;
}
.close-btn {
  background: none;
  border: none;
  font-size: v-bind(closeBtnFontSizeCss);
  color: rgba(255, 255, 255, 0.6);
  line-height: 1;
  cursor: pointer;
  padding: v-bind(closeBtnPaddingCss);
}
.close-btn:hover {
  color: #fff;
}
.panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: v-bind(bodyPaddingCss);
}
.tab-row {
  margin-bottom: v-bind(tabMarginCss);
}
.auth-form {
  display: flex;
  flex-direction: column;
  gap: v-bind(formGapCss);
}
.error-text {
  color: #ff8a80;
  font-size: v-bind(errorFontSizeCss);
  margin: 0;
}
.submit-btn {
  width: 100%;
}
.user-info {
  display: flex;
  align-items: center;
  gap: v-bind(userInfoGapCss);
}
.avatar {
  width: v-bind(avatarSizeCss);
  height: v-bind(avatarSizeCss);
  background: rgba(255, 255, 255, 0.15);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: v-bind(avatarFontSizeCss);
}
.user-details {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: v-bind(detailsGapCss);
}
.user-name {
  font-size: v-bind(userNameFontSizeCss);
  font-weight: 500;
  color: #fff;
}
</style>
