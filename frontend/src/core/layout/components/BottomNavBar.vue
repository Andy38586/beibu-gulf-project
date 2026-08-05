<script lang="ts">
export default { name: 'GCSBottomNavBar' }
</script>
<script setup lang="ts">
/**
 * BottomNavBar - 底部业务导航条
 * 职责：
 * 1. 作为唯一业务导航入口，承载 6 个核心功能按钮 + 1 个调试模式按钮
 * 2. 居中悬浮于视口底部
 * 3. 当前路由对应按钮自动高亮
 * 设计说明：
 * - 容器宽度根据 navItems.length + 1 自动计算（+1 为调试模式按钮）
 * - 内部 6 个 1×1 NavButton + 1 个调试按钮等分容器宽度
 * - 未实现业务使用 disabled 态占位，保持导航结构稳定
 * V2 变更：
 * - 移除 SAFE_MARGIN 导入（不再需要手动计算 Dock 位置）
 * - 移除 onMounted/onUnmounted（不再需要手动管理视口尺寸）
 * - 移除 viewportWidth/viewportHeight/dockLeft/dockCellX/dockCellY
 * - GCSPanel 改用 anchor="bottom-center" 由 PPS 引擎自动定位
 */

import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { navItems } from '@/core/layout/navConfig'
import { useGCS } from '@/shared'

import GCSPanel from './GCSPanel.vue'
import NavButton from './NavButton.vue'

const route = useRoute()
const router = useRouter()
const { cellPixel } = useGCS()

/**
 * 调试模式开关状态
 * - 网格参考线（GCS 验收）+ 性能监控信息（MC F3 风格）
 * - 生产可用（性能监控演示/排查）
 */
const debugMode = defineModel<boolean>('debugMode', { default: false })

// 暴露给 CSS v-bind 使用的计算属性
const toggleSizeCss = computed(() => `${Math.round(cellPixel.value * 0.75)}px`)
const toggleFontSizeCss = computed(() => `${Math.round(cellPixel.value * 0.15)}px`)
const toggleIconSizeCss = computed(() => `${Math.round(cellPixel.value * 0.175)}px`)
const toggleMarginTopCss = computed(() => `${Math.round(cellPixel.value * 0.025)}px`)

// Dock 宽度 = 导航按钮数 + 1（调试模式按钮），随 navItems 自动扩展
const dockCellCount = computed(() => navItems.value.length + 1)

// V2 变更：Dock 定位改用 PPS 的 bottom-center 锚点，不再需要手动管理视口尺寸

function isActive(item: { path?: string }) {
  if (!item.path) return false
  return route.path === item.path
}

function handleClick(item: { path?: string; disabled?: boolean }) {
  if (item.disabled || !item.path) return
  void router.push(item.path)
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
      <!-- 调试模式开关按钮 -->
      <button
        type="button"
        class="inspection-toggle"
        :class="{ active: debugMode }"
        @click="debugMode = !debugMode"
      >
        <span class="button-label">调试</span>
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
