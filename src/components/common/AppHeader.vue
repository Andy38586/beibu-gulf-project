<script setup>
import { RouterLink } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

const { user, isAuthenticated } = useAuth()
</script>

<template>
  <header class="app-header">
    <div class="logo">北部湾城市群选址分析平台</div>
    <div class="right-section">
      <nav class="nav-links">
        <RouterLink to="/" class="nav-item" active-class="active">首页</RouterLink>
        <RouterLink to="/buffer" class="nav-item" active-class="active">选址分析</RouterLink>
        <RouterLink to="/profile" class="nav-item" active-class="active">个人主页</RouterLink>
      </nav>
      <div class="auth-area">
        <template v-if="isAuthenticated">
          <RouterLink to="/profile" class="user-name">{{ user?.username }}</RouterLink>
        </template>
        <RouterLink v-else to="/profile" class="auth-btn">登录</RouterLink>
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
  height: calc(7 * var(--unit));
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 calc(2.5 * var(--unit));
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
  gap: calc(2 * var(--unit));
}
.nav-links {
  display: flex;
  gap: calc(2 * var(--unit));
}
.nav-item {
  color: white;
  text-decoration: none;
  font-size: 14px;
  padding: calc(0.5 * var(--unit)) var(--unit);
  border-radius: 4px;
  transition: background 0.15s;
}
.nav-item:hover {
  background: rgba(255, 255, 255, 0.1);
}
.nav-item.active {
  background: rgba(255, 255, 255, 0.2);
}
.auth-area {
  display: flex;
  align-items: center;
}
.user-name {
  color: white;
  text-decoration: none;
  font-size: 14px;
}
.auth-btn {
  color: white;
  text-decoration: none;
  font-size: 14px;
  padding: calc(0.5 * var(--unit)) var(--unit);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
}
.auth-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}
</style>