<script setup lang="ts">
/**
 * UserInfoCard - 个人中心顶部用户信息卡
 * 职责单一：头像 + 用户名 + 退出登录按钮（P1-10 拆分 ProfilePage 产物）
 * 直接消费 useAuth（Pinia 单例），无需 props 透传。
 */
import { computed } from 'vue'

import { useAuth } from '@/shared'
import { useGCS } from '@/shared'

const { cellPixel, css } = useGCS()
const { user, logout } = useAuth()

/* 个人中心布局尺寸（GCS cell 单位） */
const avatarSizeCss = computed(() => `${cellPixel.value * 1.2}px`)
const avatarFontCss = computed(() => `${cellPixel.value * 0.5}px`)
const logoutWidthCss = computed(() => `${cellPixel.value * 3.8}px`)
const logoutHeightCss = computed(() => `${cellPixel.value * 0.8}px`)
const logoutFontCss = computed(() => `${cellPixel.value * 0.175}px`)
const avatarText = computed(() => (user.value?.username || '?').charAt(0).toUpperCase())

/**
 * 退出登录：复用 useAuth.logout（清 HttpOnly Cookie + localStorage + 业务 store）
 */
async function handleLogout() {
  await logout()
}
</script>

<template>
  <!-- 顶部：默认头像 + 用户名（占上四分位 ~25%） -->
  <div class="profile-header">
    <div class="profile-avatar">{{ avatarText }}</div>
    <span class="profile-username">{{ user?.username }}</span>
  </div>

  <!-- 最底部：退出登录按钮（0.8×3.8 Cell，沿用原视觉语言） -->
  <div class="logout-bar">
    <button class="logout-btn-bottom" @click="handleLogout">退出登录</button>
  </div>
</template>

<style scoped>
/* 顶部：默认头像 + 用户名（占上四分位 ~25%） */
.profile-header {
  flex: 0 0 25%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-bottom: 1px solid var(--GCS-border-light);
}

.profile-avatar {
  width: v-bind(avatarSizeCss);
  height: v-bind(avatarSizeCss);
  border-radius: 50%;
  background: var(--GCS-color-primary);
  color: var(--GCS-text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: v-bind(avatarFontCss);
  font-weight: 600;
  flex-shrink: 0;
  user-select: none;
}

.profile-username {
  font-size: 14px;
  font-weight: 600;
  color: var(--GCS-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

/* 最底部：退出登录按钮（0.8×3.8 Cell，沿用原视觉语言） */
.logout-bar {
  flex: 0 0 auto;
  display: flex;
  justify-content: center;
  padding: v-bind(css.cell8px) 0;
}

.logout-btn-bottom {
  width: v-bind(logoutWidthCss);
  height: v-bind(logoutHeightCss);
  border: 1px solid var(--GCS-color-error);
  border-radius: var(--GCS-radius-md);
  background: var(--GCS-bg-panel);
  color: var(--GCS-color-error);
  font-size: v-bind(logoutFontCss);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.logout-btn-bottom:hover {
  background: var(--GCS-color-error);
  color: var(--GCS-text-inverse);
}
</style>
