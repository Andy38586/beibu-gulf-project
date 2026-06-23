<script setup>
import { RouterLink } from 'vue-router'
</script>

<template>
  <header class="app-header">
    <div class="logo">北部湾港口地图</div>
    <nav>
      <RouterLink to="/" active-class="active"> 首页 </RouterLink>
      <RouterLink to="/buffer" active-class="active"> 选址分析 </RouterLink>
      <RouterLink to="/overlay" active-class="active"> xx分析 </RouterLink>
    </nav>
  </header>
</template>

<style scoped>
.app-header {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: #2c3e50;
  color: white;
  flex-shrink: 0;
}
.logo {
  font-weight: bold;
  font-size: 16px;
}
nav {
  display: flex;
  gap: 16px;
}
nav a {
  color: #ccc;
  text-decoration: none;
  font-size: 14px;
}
nav a.active,
nav a:hover {
  color: white;
}
</style>
