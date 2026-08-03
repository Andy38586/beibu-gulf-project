<script setup lang="ts">
/**
 * AppLayout - GCS V2 布局基座（Layout Base）
 *
 * 职责：
 * 1. 通过 PPS 定位所有 Panel（无容器、无 Zone、无 TopArea）
 * 2. 提供 slot 供业务路由注入自定义 Panel 内容
 * 3. 管理检查模式状态
 *
 * V2 阶段 3 变更：
 * - 移除 TopArea 组件引用（改为独立 Panel 集合）
 * - 折线图/柱状图/雷达图/图层控制直接放入 GCSPanel slot
 * - 标题 + 城市按钮 + 个人中心按钮渲染为独立 Panel
 *
 * 使用方式：
 * <AppLayout>
 *   <template #left>自定义左侧内容</template>
 *   <template #right>自定义右侧内容</template>
 * </AppLayout>
 */

import { ref } from 'vue'
import { useRoute } from 'vue-router'

import { useScreenActions } from '@/core/layout/composables/useScreenActions.js'
import LayerControlPanel from '@/core/map/components/LayerControlPanel.vue'
import { useGCS } from '@/shared'
import PanelTitle from '@/shared/components/PanelTitle.vue'
import RadarChart from '@/visualization/charts/RadarChart.vue'

import BottomNavBar from './components/BottomNavBar.vue'
import GCSInspectionOverlay from './components/GCSInspectionOverlay.vue'
import GCSPanel from './components/GCSPanel.vue'
import MobileDrawer from './components/MobileDrawer.vue'
import NavButton from './components/NavButton.vue'
import { useMobileDrawer } from './useMobileDrawer'

const route = useRoute()
const { showPanels, showTopArea, css } = useGCS()
// 解构出 CSS 变量供 v-bind() 使用
const { cell8px } = css
const { flyToCity, goProfileOrBack, userButtonLabel } = useScreenActions()
// 移动端业务面板抽屉的开关状态（模块级单例，FAB 与抽屉共享）
const { drawerOpen, toggleDrawer, closeDrawer } = useMobileDrawer()

// 检查模式状态
const inspectionMode = ref(false)
const isDev = import.meta.env.DEV
</script>

<template>
  <div class="app-layout">
    <!-- ===== 桌面端：绝对定位 PPS 面板（≥768px） ===== -->
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

      <!-- 顶部按钮组 Panel（4×1，右上，第一行，与 Title 同行） -->
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

    <!-- ===== 移动端：抽屉承载业务面板（<768px） ===== -->
    <template v-else>
      <button type="button" class="mobile-fab" aria-label="打开业务面板" @click="toggleDrawer">
        ☰ 面板
      </button>
      <MobileDrawer :open="drawerOpen" @close="closeDrawer">
        <slot name="left" />
        <slot name="right" />
      </MobileDrawer>
    </template>

    <!-- 底部导航 -->
    <BottomNavBar v-model:inspection-mode="inspectionMode" />

    <!-- 检查模式（仅开发环境） -->
    <GCSInspectionOverlay v-if="isDev && inspectionMode" :enabled="inspectionMode" />
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

/* 顶部按钮组 Panel 内部样式 */
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

/* 图层控制面板内部样式：2 列网格，10 个按钮 */
.layer-panel-inner {
  width: 100%;
  height: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  align-content: flex-start;
  justify-content: center;
  gap: 10px; /* 10px 非8的整数倍，保留 */
  padding: 10px; /* 10px 非8的整数倍，保留 */
  box-sizing: border-box;
}

.layer-title {
  flex: none;
  font-size: 16px;
  font-weight: 600;
  color: var(--GCS-text-regular);
  padding: v-bind(cell8px) 0;
}

.layer-divider {
  flex: none;
  height: 1px;
  background-color: var(--GCS-border-light);
  margin: v-bind(cell8px) 0;
}

.layer-buttons {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 10px; /* 10px 非8的整数倍，保留 */
}

/* 移动端浮动按钮：打开业务面板抽屉（仅 <768px 由 v-else 渲染） */
.mobile-fab {
  position: absolute;
  right: 16px;
  bottom: 88px;
  z-index: 70;
  width: 56px;
  height: 56px;
  border: none;
  border-radius: var(--GCS-radius-round);
  background: var(--GCS-color-primary);
  color: var(--GCS-text-inverse);
  font-size: 14px;
  font-weight: 600;
  box-shadow: var(--GCS-shadow-md);
  cursor: pointer;
  pointer-events: auto;
  transition: transform 0.1s ease;
}
.mobile-fab:active {
  transform: scale(0.96);
}
</style>
