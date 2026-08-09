<script lang="ts">
export default { name: 'GCSBottomNavBar' }
</script>
<script setup lang="ts">
/**
 * BottomNavBar - 底部业务导航条（2026-08-09 用户决策重构）
 * 响应式三形态（消费 navConfig 注入项，core 不引 business/manifest）：
 * - 档位 1（≥960px，3 面板宽）：6 键——首页 + 4 业务 + 个人中心（路由按钮原位），无菜单键
 * - 档位 2（640~959px）：7 键——首页 + 4 业务 + 个人中心 + 菜单（保留业务按钮，不空旷）
 * - 档位 3（<640px）：3 键——首页 / 个人中心 / 菜单（放不下业务按钮，收敛为菜单入口）
 * 调试开关不在 dock（独立 DebugToggle，固定右下）
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useGCS } from '@/shared'

import { type NavItem,navItems } from '../navConfig'
import { useMobileDrawer } from '../useMobileDrawer'

import GCSButton from './GCSButton.vue'
import GCSPanel from './GCSPanel.vue'
import NavButton from './NavButton.vue'

const route = useRoute()
const router = useRouter()
const { cellPixel, navCompact, showPanels } = useGCS()
// 抽屉开关（模块级单例）：菜单按钮与抽屉共享状态，激活时高亮蓝色
const { drawerOpen, toggleDrawer } = useMobileDrawer()

// 档位 1/2 显示全部导航项（home + business + profile）；档位 3 仅 home/profile
const visibleItems = computed<NavItem[]>(() => {
  if (navCompact.value) {
    return [...navItems.value.filter((i) => i.type !== 'business')]
  }
  return [...navItems.value]
})

// dock 宽度 = 可见项 + 档位 2 的菜单键
const dockCellCount = computed(() => visibleItems.value.length + (showPanels.value ? 0 : 1))

// dock 宽度上限（防溢出兜底）：min(dock cell 宽度, 视口宽 - 16px)
const dockWidthCapCss = computed(() =>
  `min(${dockCellCount.value * cellPixel.value}px, calc(100vw - 16px))`
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
      <!-- 首页 + 业务 + 个人中心（档位 1/2 全量，档位 3 仅 home/profile） -->
      <NavButton
        v-for="item in visibleItems"
        :key="item.label"
        :label="item.label"
        :icon="item.icon"
        :disabled="item.disabled"
        :active="isActive(item.path)"
        @click="go(item)"
      />
      <!-- 菜单键（档位 2/3，<960px 抽屉模式） -->
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

/* 档位 3（<640px）dock 只有 3 键（210px < 视口），按钮保持固定 0.8 cell，
 * 由 nav-inner 的 space-around 自然分配间距——2026-08-09 修正：
 * 原 flex:1 均分让按钮占满 dock 无剩余空间，间距归零（外边距失控）。 */
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
