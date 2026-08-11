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
        @click="go(item)"
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
  z-index: 60;
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
