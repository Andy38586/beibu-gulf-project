<script setup lang="ts">
/**
 * AppLayout - GCS（网格化布局系统）V2 布局基座
 * 用 PPS（面板定位系统）直接定位所有 Panel（无容器/Zone/TopArea），slot（Vue 插槽）供业务页注入面板内容。
 * 底部 nav 3 按钮（首页/个人中心/菜单），业务入口与城市切换在抽屉菜单中；
 * 抽屉模式（<960px）下抽屉同时承载业务面板（slot left/right）。
 */

import { storeToRefs } from 'pinia'
import { computed, defineAsyncComponent, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useScreenActions } from '@/core/layout/composables/useScreenActions'
import LayerControlPanel from '@/core/map/components/LayerControlPanel.vue'
import { PanelTitle, useGCS, useTheme } from '@/shared'
import { useMapStore, useSiteSelectionStore } from '@/stores'
import { RadarChart, SNAPSHOT_SELECTED_TYPES, SNAPSHOT_XIAOQU } from '@/visualization'

import BottomNavBar from './components/BottomNavBar.vue'
import GCSPanel from './components/GCSPanel.vue'
import MobileDrawer from './components/MobileDrawer.vue'
import NavButton from './components/NavButton.vue'
import { type NavItem, navItems } from './navConfig'
import { useMobileDrawer } from './useMobileDrawer'
import { useSliderFocus } from './useSliderFocus'

// 816-专项5并 3-2：Debug 组件动态导入且仅 DEV 引用——生产构建彻底 tree-shake
// （原静态 import 使 debug chunk 进生产包，违反 03 §三.3「仅 dev 构建加载」）
const DebugToggle = import.meta.env.DEV
  ? defineAsyncComponent(() => import('./components/DebugToggle.vue'))
  : null
const GCSDebugOverlay = import.meta.env.DEV
  ? defineAsyncComponent(() => import('./components/GCSDebugOverlay.vue'))
  : null

const route = useRoute()
const router = useRouter()
const { showPanels, showTopArea } = useGCS()
const { flyToCity } = useScreenActions()
// 主题切换：图标显示当前模式的另一侧（暗色显示 ☀️、亮色显示 🌙）
const { isDark, toggleTheme } = useTheme()
// 抽屉开关（模块级单例，nav 菜单按钮与抽屉共享）
const { drawerOpen, closeDrawer } = useMobileDrawer()
// 滑块专注模式（模块级单例，滑块组件调用 begin/end）
const { active: sliderFocusActive, activePanel: sliderActivePanel } = useSliderFocus()

// 抽屉业务行：取 navConfig 中 type=business 的项（core 不引 business，由 App.vue 注入）
const businessNavItems = computed<NavItem[]>(() => [
  ...navItems.value.filter((i) => i.type === 'business'),
])

// 全局雷达图数据（与选址分析页同源）：分析结果第一名，无结果用快照兜底（面板不空态）
const siteSelectionStore = useSiteSelectionStore()
const radarXiaoqu = computed(() => siteSelectionStore.matchedXiaoqu[0] ?? SNAPSHOT_XIAOQU)
const radarSelectedTypes = computed(() =>
  siteSelectionStore.selectedTypes.length > 0
    ? siteSelectionStore.selectedTypes
    : SNAPSHOT_SELECTED_TYPES
)

// 调试模式状态（网格 + 性能监控，类似 MC F3）
// 仅本地开发渲染：import.meta.env.DEV 是编译期常量，生产构建后 v-if 恒 false；
// 状态住 mapStore（引擎徽标等 DEV 标号跨组件消费同一开关，Pinia 单一状态）
const showDebug = import.meta.env.DEV
const mapStore = useMapStore()
const { debugMode } = storeToRefs(mapStore)

// 专注模式 class 挂 body 而非根节点：抽屉 Teleport 到 body，根节点选择器匹配不到抽屉内面板。
// body 加 slider-focus-mode（CSS 透明化其他面板），滑块所在面板标记 slider-focus-panel，底部 nav 排除。
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

      <!-- 顶部城市切换按钮组（4×1 右上，档位 1 原位显示；<960px 时在抽屉菜单内） -->
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
          <!-- 主题切换（🌙/☀️） -->
          <NavButton
            :icon="isDark ? '☀️' : '🌙'"
            class="theme-toggle"
            aria-label="切换主题"
            @click="toggleTheme"
          />
        </div>
      </GCSPanel>

      <!-- 左侧 Panel 组：由业务页通过 #left slot 注入 -->
      <slot name="left" />

      <!-- 右侧 Panel 组 -->
      <div v-show="showPanels">
        <slot name="right">
          <!-- 右上：雷达图 4×4（与选址分析同源：分析结果第一名，未分析时快照兜底） -->
          <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
            <RadarChart
              :visible="true"
              :xiaoqu="radarXiaoqu"
              :selected-types="radarSelectedTypes"
              :embedded="false"
              :facility-poi="siteSelectionStore.facilityPoi"
            />
          </GCSPanel>
          <!-- 右下：图层控制 4×4 -->
          <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
            <LayerControlPanel />
          </GCSPanel>
        </slot>
      </div>
    </template>

    <!-- ===== 抽屉菜单（抽屉模式 <960px） =====
         业务入口（sticky 冻结首行）+ 城市切换 + 业务面板；档位 1 时菜单键不存在 -->
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
        <!-- 城市切换 + 主题切换行 -->
        <div class="drawer-menu__row" aria-label="城市切换">
          <NavButton label="钦州" @click="flyToCity('钦州')" />
          <NavButton label="北海" @click="flyToCity('北海')" />
          <NavButton label="防城港" @click="flyToCity('防城港')" />
          <NavButton
            :icon="isDark ? '☀️' : '🌙'"
            class="theme-toggle"
            aria-label="切换主题"
            @click="toggleTheme"
          />
        </div>
        <!-- 抽屉面板内容：只放功能面板；首页→图层控制，个人中心→right slot，业务页→left/right slot -->
        <template v-if="!showPanels">
          <template v-if="route.name === 'Home'">
            <GCSPanel :w="4" :h="4"><LayerControlPanel /></GCSPanel>
          </template>
          <template v-else-if="route.name === 'Profile'">
            <slot name="right" />
          </template>
          <template v-else>
            <!-- 操作/控制面板（right slot）在前，可视化面板（left slot）在后：避免首屏全是空白图表 -->
            <slot name="right" />
            <slot name="left" />
          </template>
        </template>
      </div>
    </MobileDrawer>

    <!-- 独立调试开关：仅本地开发渲染，固定右下、不随响应式布局变化 -->
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
  z-index: var(--GCS-z-layout); /* 816-S7-40：壳层档（原散落 50） */
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

/* 顶部城市切换按钮组内部样式 */
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

/* ===== 抽屉菜单 ===== */
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

  /* 816-S7-40：局部层叠上下文（抽屉 body 内），不参与全局 --GCS-z-* 刻度 */
  z-index: 5;
  background: var(--GCS-bg-panel);
  border-bottom: 1px solid var(--GCS-border-light);
}

/* 主题切换按钮 emoji 放大（默认偏小，仅作用于 .theme-toggle） */
:deep(.theme-toggle .button-icon) {
  font-size: 1.6em;
  margin-top: 0;
}
</style>
