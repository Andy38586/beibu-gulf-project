<script lang="ts">
export default { name: 'GCSBottomNavBar' }
</script>
<script setup lang="ts">
/**
 * BottomNavBar - 底部业务导航条
 *
 * 职责：
 * 1. 作为唯一业务导航入口，承载 6 个核心功能按钮 + 1 个检查模式按钮
 * 2. 居中悬浮于视口底部
 * 3. 当前路由对应按钮自动高亮
 *
 * 设计说明：
 * - 容器宽度根据 navItems.length + 1 自动计算（+1 为检查模式按钮）
 * - 内部 6 个 1×1 NavButton + 1 个检查按钮等分容器宽度
 * - 未实现业务使用 disabled 态占位，保持导航结构稳定
 *
 * V2 变更：
 * - 移除 SAFE_MARGIN 导入（不再需要手动计算 Dock 位置）
 * - 移除 onMounted/onUnmounted（不再需要手动管理视口尺寸）
 * - 移除 viewportWidth/viewportHeight/dockLeft/dockCellX/dockCellY
 * - GCSPanel 改用 anchor="bottom-center" 由 PPS 引擎自动定位
 */

import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useGCS } from '../useGCS.js'

import GCSPanel from './GCSPanel.vue'
import NavButton from './NavButton.vue'

const route = useRoute()
const router = useRouter()
const { cellPixel } = useGCS()

/**
 * 检查模式开关状态
 * - 用于开发验收，验证 GCS 是否正确落地
 * - 生产环境默认关闭
 */
const inspectionMode = defineModel('inspectionMode', { type: Boolean, default: false })

// 暴露给 CSS v-bind 使用的计算属性
const toggleSizeCss = computed(() => `${Math.round(cellPixel.value * 0.75)}px`)
const toggleFontSizeCss = computed(() => `${Math.round(cellPixel.value * 0.15)}px`)
const toggleIconSizeCss = computed(() => `${Math.round(cellPixel.value * 0.175)}px`)
const toggleMarginTopCss = computed(() => `${Math.round(cellPixel.value * 0.025)}px`)

/**
 * 底部导航按钮配置
 * - 已启用：首页、选址分析、个人中心
 * - 未启用：吞吐量、热力图、航线分析（disabled 占位）
 */
const navItems = computed(() => [
  { label: '首页', icon: '⌂', route: '/', disabled: false },
  { label: '选址分析', icon: '◈', route: '/site-selection', disabled: false },
  { label: '预测分析', icon: '📊', route: '/forecast', disabled: false },
  { label: '浸没分析', icon: '🌊', route: '/flood-analysis', disabled: false },
  { label: '航线分析', icon: '🚢', route: '/route-analysis', disabled: true },
  { label: '个人中心', icon: '👤', route: '/profile', disabled: false },
])

// Dock 宽度 = 导航按钮数 + 1（检查模式按钮），随 navItems 自动扩展
const dockCellCount = computed(() => navItems.value.length + 1)

// V2 变更：Dock 定位改用 PPS 的 bottom-center 锚点，不再需要手动管理视口尺寸

function isActive(item: { route?: string }) {
  if (!item.route) return false
  return route.path === item.route
}

function handleClick(item: { route?: string; disabled?: boolean }) {
  if (item.disabled || !item.route) return
  router.push(item.route)
}
</script>

<template>
  <GCSPanel
    :w="dockCellCount"
    :h="1"
    anchor="bottom-center"
    :offset-x="0"
    :offset-y="0"
    class="bottom-nav-bar dock-panel"
  >
    <div class="nav-inner">
      <NavButton
        v-for="item in navItems"
        :key="item.label"
        :label="item.label"
        :icon="item.icon"
        :disabled="item.disabled"
        :active="isActive(item)"
        @click="handleClick(item)"
      />
      <!-- 检查模式开关按钮 -->
      <button
        type="button"
        class="inspection-toggle"
        :class="{ active: inspectionMode }"
        @click="inspectionMode = !inspectionMode"
      >
        <span class="button-label">检查</span>
        <span class="button-icon">🔍</span>
      </button>
    </div>
  </GCSPanel>
</template>

<style scoped>
.bottom-nav-bar {
  z-index: 60;
  pointer-events: auto;
}

.nav-inner {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-around;
  box-sizing: border-box;
}

.inspection-toggle {
  flex: 0 0 auto;
  width: v-bind(toggleSizeCss);
  height: v-bind(toggleSizeCss);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--GCS-bg-panel);
  border: 2px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-md);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: v-bind(toggleFontSizeCss);
  color: var(--GCS-text-regular);
}

.inspection-toggle:hover {
  background: var(--GCS-bg-container);
  border-color: var(--GCS-color-primary);
}

.inspection-toggle.active {
  background: var(--GCS-color-primary);
  border-color: var(--GCS-color-primary);
  color: var(--GCS-bg-panel);
}

.inspection-toggle .button-label {
  font-weight: 500;
  line-height: 1.2;
}

.inspection-toggle .button-icon {
  font-size: v-bind(toggleIconSizeCss);
  margin-top: v-bind(toggleMarginTopCss);
}
</style>
