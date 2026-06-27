<script setup>
import { RouterLink } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

const emit = defineEmits(['open-login', 'open-plans'])
const { user, isAuthenticated, logout } = useAuth()

function handleLogout() {
  logout()
}
</script>

<template>
  <header class="app-header">
    <div class="logo">北部湾城市群地图</div>
    <div class="right-section">
      <nav class="nav-links">
        <RouterLink to="/" class="nav-item" active-class="active">首页</RouterLink>
        <RouterLink to="/buffer" class="nav-item" active-class="active">选址分析</RouterLink>
        <RouterLink to="/overlay" class="nav-item" active-class="active">xx分析</RouterLink>
      </nav>
      <div class="auth-area">
        <template v-if="isAuthenticated">
          <span class="user-name">{{ user?.username }}</span>
          <button class="auth-btn" @click="emit('open-plans')">我的方案</button>
          <button class="auth-btn" @click="handleLogout">退出</button>
        </template>
        <button v-else class="auth-btn" @click="emit('open-login')">登录</button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: rgba(44, 62, 80, 0.35);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  color: white;
}
.logo {
  font-weight: bold;
  font-size: 16px;
}
.right-section {
  display: flex;
  align-items: center;
  gap: 16px;
}
.nav-links {
  display: flex;
  gap: 8px;
}
.nav-item {
  color: rgba(255, 255, 255, 0.85);
  text-decoration: none;
  font-size: 14px;
  padding: 6px 14px;
  border-radius: 8px;
  transition:
    background 0.2s,
    color 0.2s;
}
.nav-item:hover {
  background: rgba(255, 255, 255, 0.15);
  color: white;
}
.nav-item.active {
  background: rgba(64, 158, 255, 0.85);
  color: white;
  font-weight: 500;
}
.auth-area {
  display: flex;
  align-items: center;
  gap: 8px;
}
.user-name {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
}
.auth-btn {
  padding: 5px 14px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 6px;
  background: transparent;
  color: white;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
}
.auth-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}
</style>
