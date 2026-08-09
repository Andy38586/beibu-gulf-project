<script setup lang="ts">
/**
 * UserInfoCard - 个人中心顶部用户信息卡
 * 职责单一：头像 + 用户名（P1-10 拆分 ProfilePage 产物）
 * 退出登录按钮在 ProfilePage 底部（2026-08-09：原在卡片内导致位于收藏面板上方，
 * 非整面板最底；退出按钮独立下沉由 ProfilePage 负责）。
 * 直接消费 useAuth（Pinia 单例），无需 props 透传。
 */
import { computed } from 'vue'

import { useAuth } from '@/shared'
import { useGCS } from '@/shared'

const { cellPixel } = useGCS()
const { user } = useAuth()

const avatarSizeCss = computed(() => `${cellPixel.value * 1.2}px`)
const avatarFontCss = computed(() => `${cellPixel.value * 0.5}px`)
const avatarText = computed(() => (user.value?.username || '?').charAt(0).toUpperCase())
</script>

<template>
  <!-- 顶部：默认头像 + 用户名（占上四分位 ~25%） -->
  <div class="profile-header">
    <div class="profile-avatar">{{ avatarText }}</div>
    <span class="profile-username">{{ user?.username }}</span>
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
</style>
