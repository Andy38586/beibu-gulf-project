<script setup>
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
 * - 折线图/柱状图/雷达图/图层控制直接放入 GcsPanel slot
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
import { useGCS } from './useGCS.js'
import BottomNavBar from './components/BottomNavBar.vue'
import GcsInspectionOverlay from './components/GcsInspectionOverlay.vue'
import GcsPanel from './components/GcsPanel.vue'
import NavButton from './components/NavButton.vue'
import PanelTitle from '@/shared/components/PanelTitle.vue'
import LineChart from '@/visualization/charts/LineChart.vue'
import BarChart from '@/visualization/charts/BarChart.vue'
import RadarChart from '@/visualization/charts/RadarChart.vue'
import LayerControlPanel from '@/shared/components/LayerControlPanel.vue'
import { useScreenActions } from '@/shared/composables/useScreenActions.js'

const route = useRoute()
const { showPanels, showTopArea, css } = useGCS()
// 解构出 CSS 变量供 v-bind() 使用
const { cell8px } = css
const { flyToCity, goProfileOrBack, userButtonLabel } = useScreenActions()

// 检查模式状态
const inspectionMode = ref(false)
const isDev = import.meta.env.DEV

/**
 * 折线图数据（默认数据，与旧版 Zone2 一致）
 */
const chartData = {
  labels: ['2019', '2020', '2021', '2022', '2023', '2024'],
  series: [
    { name: '钦州港', data: [120, 132, 101, 134, 190, 230] },
    { name: '北海港', data: [90, 110, 120, 115, 140, 180] },
    { name: '防城港', data: [80, 95, 110, 125, 150, 170] },
  ],
}

/**
 * 柱状图数据（默认数据，与旧版 Zone5 一致）
 */
const barData = {
  labels: ['钦州港', '北海港', '防城港'],
  series: [
    { name: '2023年', data: [190, 140, 150] },
    { name: '2024年', data: [230, 180, 170] },
  ],
}
</script>

<template>
  <div class="app-layout">
    <!-- Title Panel（4×1，左上，第一行） -->
    <GcsPanel
      v-show="showTopArea"
      :w="4"
      :h="1"
      anchor="top-left"
      :offset-x="0"
      :offset-y="0"
      class="title-panel"
    >
      <PanelTitle :title="route.meta?.title || '北部湾智慧港口平台'" />
    </GcsPanel>

    <!-- 顶部按钮组 Panel（4×1，右上，第一行，与 Title 同行） -->
    <GcsPanel
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
    </GcsPanel>

    <!-- 左侧 Panel 组 -->
    <slot name="left">
      <!-- 左上：折线图 4×4 -->
      <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
        <LineChart title="港口吞吐量趋势" :x-data="chartData.labels" :series="chartData.series" />
      </GcsPanel>
      <!-- 左下：柱状图 4×4 -->
      <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
        <BarChart title="港口吞吐量对比" :x-data="barData.labels" :series="barData.series" />
      </GcsPanel>
    </slot>

    <!-- 右侧 Panel 组 -->
    <div v-show="showPanels">
      <slot name="right">
        <!-- 右上：雷达图 4×4 -->
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <RadarChart
            :visible="true"
            :xiaoqu="null"
            :selected-types="[]"
            :embedded="false"
            :facility-poi="{}"
          />
        </GcsPanel>
        <!-- 右下：图层控制 4×4（接入真实功能） -->
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel />
        </GcsPanel>
      </slot>
    </div>

    <!-- 底部导航 -->
    <BottomNavBar v-model:inspectionMode="inspectionMode" />

    <!-- 检查模式（仅开发环境） -->
    <GcsInspectionOverlay v-if="isDev && inspectionMode" :enabled="inspectionMode" />
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
  color: #333;
  padding: v-bind(cell8px) 0;
}

.layer-divider {
  flex: none;
  height: 1px;
  background-color: #f0f0f0;
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
</style>
