<script setup lang="ts">
/**
 * AppLayout - GCS V2 布局基座（Layout Base）
 * 职责：
 * 1. 通过 PPS 定位所有 Panel（无容器、无 Zone、无 TopArea）
 * 2. 提供 slot 供业务路由注入自定义 Panel 内容
 * 3. 管理调试模式状态
 * 2026-08-09 重构（用户决策）：
 * - 底部 nav 收敛为 3 按钮（首页/个人中心/菜单）
 * - 业务入口（4 个）+ 城市切换全部移入抽屉菜单（业务行 sticky 冻结）
 * - 顶部城市切换按钮组移除；抽屉所有档位可用（桌面模式开抽屉 = 业务菜单）
 * - 抽屉模式下（<960px）抽屉同时承载业务面板（slot left/right）
 */

import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useScreenActions } from '@/core/layout/composables/useScreenActions'
import LayerControlPanel from '@/core/map/components/LayerControlPanel.vue'
import { useGCS } from '@/shared'
import PanelTitle from '@/shared/components/PanelTitle.vue'
import RadarChart from '@/visualization/charts/RadarChart.vue'

import BottomNavBar from './components/BottomNavBar.vue'
import DebugToggle from './components/DebugToggle.vue'
import GCSDebugOverlay from './components/GCSDebugOverlay.vue'
import GCSPanel from './components/GCSPanel.vue'
import MobileDrawer from './components/MobileDrawer.vue'
import NavButton from './components/NavButton.vue'
import { type NavItem, navItems } from './navConfig'
import { useMobileDrawer } from './useMobileDrawer'
import { useSliderFocus } from './useSliderFocus'

const route = useRoute()
const router = useRouter()
const { showPanels, showTopArea } = useGCS()
const { flyToCity, goProfileOrBack, userButtonLabel } = useScreenActions()
// 抽屉开关（模块级单例，nav 菜单按钮与抽屉共享）
const { drawerOpen, closeDrawer } = useMobileDrawer()
// 滑块专注模式（模块级单例，滑块组件调用 begin/end）
const { active: sliderFocusActive, activePanel: sliderActivePanel } = useSliderFocus()

// 抽屉业务行：navConfig 中 type=business 的项（core 不引 business/manifest，由 App.vue 注入）
const businessNavItems = computed<NavItem[]>(() => [
  ...navItems.value.filter((i) => i.type === 'business'),
])

// 调试模式状态（网格 + 性能监控，类似 MC F3；生产可用）
// 2026-08-09 用户决策：调试板块仅本地开发渲染（上线不带调试模式，无需第二套环境）——
// import.meta.env.DEV 在 vite dev 下为 true、build 时为 false（编译期常量），
// 生产构建后 v-if 恒 false，调试组件不创建、不渲染。
const debugMode = ref(false)
const showDebug = import.meta.env.DEV

// 滑块专注模式：class 挂到 body（MobileDrawer Teleport 到 body，抽屉不在 .app-layout 内，
// 挂根节点会导致抽屉内的面板匹配不到 .slider-focus-mode 选择器，2026-08-09 实测）。
// 激活时 body 加 slider-focus-mode（CSS 透明化其他面板），滑块所在面板标记 slider-focus-panel；
// 底部 nav（.bottom-nav-bar）与 .slider-focus-panel 由 CSS 排除，保持可见。
watch(sliderFocusActive, (act) => {
  document.body.classList.toggle('slider-focus-mode', act)
  if (act) {
    document.querySelectorAll('.GCS-panel').forEach((p) => {
      p.classList.toggle('slider-focus-panel', p === sliderActivePanel.value)
    })
  }
})

function isActive(path: string): boolean {
  return route.path === path
}

/** 跳转业务模块并关闭抽屉（navConfig 注入项） */
function goBusiness(item: NavItem): void {
  if (item.disabled || !item.path) return
  void router.push(item.path)
  closeDrawer()
}
</script>

<template>
  <div class="app-layout">
    <!-- ===== 桌面端：绝对定位 PPS 面板（≥960px） ===== -->
    <template v-if="showPanels">
      <!-- Title Panel（4×1，左上，第一行） -->
      <GCSPanel
        v-show="showTopArea"
        :w="4"
        :h="1"
        anchor="top-left"
        :offset-x="0"
        :offset-y="0"
        class="title-panel"
      >
        <PanelTitle :title="(route.meta?.title as string) || '北部湾智慧港口平台'" />
      </GCSPanel>

      <!-- 顶部城市切换按钮组 Panel（4×1，右上，与 Title 同行；2026-08-09 回归——
           档位 1（≥960px）原位显示；<960px 时城市按钮在抽屉菜单内） -->
      <GCSPanel
        v-show="showTopArea"
        :w="4"
        :h="1"
        anchor="top-right"
        :offset-x="0"
        :offset-y="0"
        class="top-button-panel"
      >
        <div class="top-button-inner">
          <NavButton label="钦州" @click="flyToCity('钦州')" />
          <NavButton label="北海" @click="flyToCity('北海')" />
          <NavButton label="防城港" @click="flyToCity('防城港')" />
          <NavButton :label="userButtonLabel" icon="👤" @click="goProfileOrBack" />
        </div>
      </GCSPanel>

      <!-- 左侧 Panel 组（c023：默认内容移除，由业务页通过 #left slot 注入） -->
      <slot name="left" />

      <!-- 右侧 Panel 组 -->
      <div v-show="showPanels">
        <slot name="right">
          <!-- 右上：雷达图 4×4 -->
          <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
            <RadarChart
              :visible="true"
              :xiaoqu="null"
              :selected-types="[]"
              :embedded="false"
              :facility-poi="{}"
            />
          </GCSPanel>
          <!-- 右下：图层控制 4×4（接入真实功能） -->
          <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
            <LayerControlPanel />
          </GCSPanel>
        </slot>
      </div>
    </template>

    <!-- ===== 抽屉菜单（仅 <960px，2026-08-09） =====
         档位 2/3：业务入口（sticky 冻结首行）+ 城市切换 + 业务面板
         档位 1（≥960px）：路由/城市按钮原位显示，菜单键不存在，抽屉不可达 -->
    <MobileDrawer :open="drawerOpen" @close="closeDrawer">
      <div class="drawer-menu">
        <!-- 业务入口行：滚动时冻结（sticky） -->
        <div class="drawer-menu__row drawer-menu__row--sticky" aria-label="业务功能">
          <NavButton
            v-for="m in businessNavItems"
            :key="m.label"
            :label="m.label"
            :icon="m.icon"
            :disabled="m.disabled"
            :active="isActive(m.path)"
            @click="goBusiness(m)"
          />
        </div>
        <!-- 城市切换 + 用户入口行 -->
        <div class="drawer-menu__row" aria-label="城市切换">
          <NavButton label="钦州" @click="flyToCity('钦州')" />
          <NavButton label="北海" @click="flyToCity('北海')" />
          <NavButton label="防城港" @click="flyToCity('防城港')" />
          <NavButton :label="userButtonLabel" icon="👤" @click="goProfileOrBack" />
        </div>
        <!-- 抽屉模式（<960px）面板内容（2026-08-09 用户决策：只留功能面板，图表类纯充数不进抽屉）：
             首页 → 图层控制（core 组件）；个人中心 → 登录面板（由 ProfilePage 经 #right slot 注入）；
             业务页 → 业务面板原样 -->
        <template v-if="!showPanels">
          <template v-if="route.name === 'Home'">
            <GCSPanel :w="4" :h="4"><LayerControlPanel /></GCSPanel>
          </template>
          <template v-else-if="route.name === 'Profile'">
            <slot name="right" />
          </template>
          <template v-else>
            <!-- 2026-08-10：抽屉模式面板顺序——操作/控制面板（right slot：操作台+图层控制）
                 在前，可视化面板（left slot：图表/名单/报告）在后。
                 原 left 在前导致打开菜单首屏全是空白图表（白板），操作台在底部要滚动才能看到 -->
            <slot name="right" />
            <slot name="left" />
          </template>
        </template>
      </div>
    </MobileDrawer>

    <!-- 独立调试开关：仅本地开发渲染（import.meta.env.DEV），固定右下、不随响应式布局变化
         （独立板块，生产构建不创建；如需彻底从 bundle 剔除用动态 import 方案） -->
    <DebugToggle v-if="showDebug" v-model="debugMode" />

    <!-- 底部导航（3 按钮：首页/个人中心/菜单） -->
    <BottomNavBar />

    <!-- 调试模式：网格参考线 + 性能监控信息（MC F3 风格，不拦截鼠标，仅本地开发） -->
    <GCSDebugOverlay v-if="showDebug && debugMode" :enabled="debugMode" />
  </div>
</template>

<style scoped>
.app-layout {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 50;
}

/* 所有 Panel 子元素恢复 pointer-events */
.app-layout > * {
  pointer-events: auto;
}

/* Title Panel 容器样式 */
.title-panel {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 顶部城市切换按钮组 Panel 内部样式（档位 1 原位显示） */
.top-button-panel {
  display: flex;
  align-items: center;
  justify-content: center;
}

.top-button-inner {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-around;
  box-sizing: border-box;
}

/* ===== 抽屉菜单（2026-08-09） ===== */
.drawer-menu {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.drawer-menu__row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  padding: 8px 0;
}

/* 业务入口行冻结：抽屉 body 滚动时保持可见（sticky 相对 .GCS-drawer__body） */
.drawer-menu__row--sticky {
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--GCS-bg-panel);
  border-bottom: 1px solid var(--GCS-border-light);
}
</style>
