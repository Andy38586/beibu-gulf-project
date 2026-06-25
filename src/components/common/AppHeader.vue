<script setup>
import { RouterLink } from 'vue-router'
</script>

<template>
  <header class="app-header">
    <div class="logo">北部湾港口地图</div>
    <nav>
      <RouterLink to="/" class="nav-item" active-class="active">首页</RouterLink>
      <RouterLink to="/buffer" class="nav-item" active-class="active">选址分析</RouterLink>
      <RouterLink to="/overlay" class="nav-item" active-class="active">xx分析</RouterLink>
    </nav>
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
nav {
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
</style>
