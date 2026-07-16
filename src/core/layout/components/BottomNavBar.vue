<script>
export default { name: 'GcsBottomNavBar' }
</script>

<script setup>
/**
 * BottomNavBar - 底部业务导航条
 *
 * 职责：
 * 1. 作为唯一业务导航入口，承载 6 个核心功能按钮
 * 2. 居中悬浮于视口底部
 * 3. 当前路由对应按钮自动高亮
 *
 * 设计说明：
 * - 容器使用 6×1 GcsPanel，确保与顶部/左右 Panel 视觉统一
 * - 内部 6 个 1×1 NavButton 等分容器宽度
 * - 未实现业务使用 disabled 态占位，保持导航结构稳定
 */

import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import GcsPanel from './GcsPanel.vue'
import NavButton from './NavButton.vue'
import { GAP } from '../config.js'

const route = useRoute()
const router = useRouter()

/**
 * 底部导航按钮配置
 * - 已启用：首页、选址分析、个人中心
 * - 未启用：吞吐量、热力图、航线分析（disabled 占位）
 */
const navItems = computed(() => [
  { label: '首页', icon: '⌂', route: '/', disabled: false },
  { label: '选址', icon: '◈', route: '/site-selection', disabled: false },
  { label: '吞吐量', icon: '📊', route: '/throughput', disabled: true },
  { label: '热力图', icon: '▣', route: '/heatmap', disabled: true },
  { label: '航线', icon: '✈', route: '/route-analysis', disabled: true },
  { label: '个人', icon: '👤', route: '/profile', disabled: false },
])

function isActive(item) {
  if (!item.route) return false
  return route.path === item.route
}

function handleClick(item) {
  if (item.disabled || !item.route) return
  router.push(item.route)
}
</script>

<template>
  <GcsPanel :w="6" :h="1" class="bottom-nav-bar">
    <div class="nav-inner" :style="{ gap: `${GAP}px` }">
      <NavButton
        v-for="item in navItems"
        :key="item.label"
        :label="item.label"
        :icon="item.icon"
        :disabled="item.disabled"
        :active="isActive(item)"
        @click="handleClick(item)"
      />
    </div>
  </GcsPanel>
</template>

<style scoped>
.bottom-nav-bar {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  pointer-events: auto;
}

.nav-inner {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
</style>
