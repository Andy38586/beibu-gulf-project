<script lang="ts">
export default { name: 'GCSBottomNavBar' }
</script>
<script setup lang="ts">
/**
 * BottomNavBar - 底部业务导航条（消费 navConfig 注入项，core 不引 business）
 * 三档形态：档位 1（≥960px）首页+业务+个人中心原位、无菜单键；
 * 档位 2（640~959px）追加菜单键；档位 3（<640px）仅首页/个人中心/菜单。
 * 调试开关不在 dock（独立 DebugToggle，固定右下）。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useGCS } from '@/shared'

import { type NavItem, navItems } from '../navConfig'
import { useMobileDrawer } from '../useMobileDrawer'

import { preloadCesium } from '../../map/renderers'

import GCSButton from './GCSButton.vue'
import GCSPanel from './GCSPanel.vue'
import NavButton from './NavButton.vue'

const route = useRoute()
const router = useRouter()
const { cellPixel, navCompact, showPanels } = useGCS()
// 抽屉开关（模块级单例）：菜单按钮与抽屉共享，激活时高亮
const { drawerOpen, toggleDrawer } = useMobileDrawer()

// 档位 1/2 显示全部导航项（home + business + profile）；档位 3 仅 home/profile
const visibleItems = computed<NavItem[]>(() => {
  if (navCompact.value) {
    return [...navItems.value.filter((i) => i.type !== 'business')]
  }
  return [...navItems.value]
})

// dock 宽度 = 可见项 + 抽屉模式下的菜单键
const dockCellCount = computed(() => visibleItems.value.length + (showPanels.value ? 0 : 1))

// dock 宽度上限（防溢出兜底）：min(dock cell 宽度, 视口宽 - 16px)
const dockWidthCapCss = computed(
  () => `min(${dockCellCount.value * cellPixel.value}px, calc(100vw - 16px))`
)

function isActive(path: string): boolean {
  return route.path === path
}

function go(item: NavItem): void {
  if (item.disabled || !item.path) return
  void router.push(item.path)
}

/**
 * 3D 意图预取（2026-10-01，治 z037「点不进 浸没分析」）
 *
 * 背景：3D 页首次进入需现场下载 Cesium.js（5.8MB）并建首帧；真机限速实测
 * 进入耗时 10–16s，用户体感即"点了没反应/点不进去"（实测点击从未被吞：
 * 全屏「地图加载中」遮罩在地图层 stacking context 内，导航 z 序在其上）。
 *
 * 不在启动时全量预载：App.vue 的预热队列刻意错峰到 load 后 +3s，避免抢首屏带宽。
 * 这里只在**指针悬停/键盘聚焦 3D 导航项**时按需预取——意图明确、对首屏零成本；
 * 且 preloadCesium 是模块级幂等 promise，重复触发不产生重复下载。
 */
function preloadIf3D(item: NavItem): void {
  if (item.disabled || !item.path) return
  if (router.resolve(item.path).meta?.engine === '3d') preloadCesium()
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
    :class="{ 'nav-compact': navCompact }"
    :style="{ maxWidth: dockWidthCapCss }"
  >
    <div class="nav-inner">
      <!-- 档位 1/2 全量导航；档位 3 仅首页/个人中心 -->
      <NavButton
        v-for="item in visibleItems"
        :key="item.label"
        :label="item.label"
        :icon="item.icon"
        :disabled="item.disabled"
        :active="isActive(item.path)"
        :task-route="item.path"
        @click="go(item)"
        @mouseenter="preloadIf3D(item)"
        @focusin="preloadIf3D(item)"
      />
      <!-- 菜单键（抽屉模式 <960px） -->
      <GCSButton
        v-if="!showPanels"
        :w="0.8"
        :h="0.8"
        label="菜单"
        icon="☰"
        :active="drawerOpen"
        @click="toggleDrawer"
      />
    </div>
  </GCSPanel>
</template>

<style scoped>
.bottom-nav-bar {
  z-index: var(--GCS-z-nav); /* 导航档（原散落 60） */
  pointer-events: auto;
}

/* 档位 3 dock 只有 3 键：按钮保持固定尺寸，由 space-around 分配间距
 * （flex:1 均分会导致无剩余空间、间距归零） */
.bottom-nav-bar.nav-compact {
  min-width: 0 !important;
}

.nav-inner {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-around;
  box-sizing: border-box;
}
</style>
