<script setup>
/**
 * AppLayout - GCS 布局基座（Layout Base）
 *
 * 职责：
 * 1. 定义四层职责分离的界面结构：TopArea / LeftContainer / RightContainer / BottomNavBar
 * 2. 基于 CELL_PIXEL 计算各层位置与尺寸
 * 3. 提供 left / right 两个业务插槽，默认渲染 Zone2/Zone3/Zone4
 *
 * 结构说明：
 * - TopArea：顶部全局导航与城市定位
 * - LeftContainer：左上可视化区 + 左下图层控制区
 * - RightContainer：右下结果展示区（业务路由可注入业务面板）
 * - BottomNavBar：底部业务导航条
 *
 * 使用方式：
 * <AppLayout>
 *   <template #left>自定义左侧内容</template>
 *   <template #right>自定义右侧内容</template>
 * </AppLayout>
 */

import { computed } from 'vue'
import { useGCS } from './useGCS.js'
import TopArea from './components/TopArea.vue'
import BottomNavBar from './components/BottomNavBar.vue'
import Zone2 from './components/Zone2.vue'
import Zone3 from './components/Zone3.vue'
import Zone4 from './components/Zone4.vue'

const { cell, cellPixel, padding, showPanels, showTopArea } = useGCS()

// 安全边距：容器与视口边缘的距离
const SAFE_MARGIN = 20

// 顶部功能区高度 = 1 个 Cell
const topAreaHeight = computed(() => cellPixel.value)

// 底部导航条高度 = 1 个 Cell
const bottomNavHeight = computed(() => cellPixel.value)

// 单个 Zone 固定占 4×4 个 Cell
const zoneSize = computed(() => cell(4, 4))

// Zone 内边距 = CELL_PADDING，确保内部 Panel 不贴边
const zonePadding = computed(() => `${padding}px`)

// 左右容器可用高度：视口高度 - 顶部 - 底部 - 安全边距
const containerHeight = computed(() => {
  if (typeof window === 'undefined') return '100vh'
  return `${window.innerHeight - topAreaHeight.value - bottomNavHeight.value - SAFE_MARGIN * 2}px`
})

// 容器宽度与单个 Zone 保持一致（4×4 Cell）
const containerWidth = computed(() => zoneSize.value.width)

// 左侧容器定位样式
const leftContainerStyle = computed(() => ({
  position: 'absolute',
  top: `${topAreaHeight.value + SAFE_MARGIN}px`,
  left: `${SAFE_MARGIN}px`,
  width: containerWidth.value,
  height: containerHeight.value,
  display: 'flex',
  flexDirection: 'column',
  gap: `${SAFE_MARGIN}px`,
  pointerEvents: 'none',
}))

// 右侧容器定位样式
const rightContainerStyle = computed(() => ({
  position: 'absolute',
  top: `${topAreaHeight.value + SAFE_MARGIN}px`,
  right: `${SAFE_MARGIN}px`,
  width: containerWidth.value,
  height: containerHeight.value,
  display: 'flex',
  flexDirection: 'column',
  gap: `${SAFE_MARGIN}px`,
  pointerEvents: 'none',
}))
</script>

<template>
  <div class="app-layout">
    <!-- 第一层：顶部功能区 -->
    <TopArea v-show="showTopArea" />

    <!-- 第二层：左侧容器（可视化 + 图层控制） -->
    <div v-show="showPanels" class="left-container" :style="leftContainerStyle">
      <slot name="left">
        <div class="zone zone-2" :style="zoneSize">
          <Zone2 />
        </div>
        <div class="zone zone-3" :style="zoneSize">
          <Zone3 />
        </div>
      </slot>
    </div>

    <!-- 第三层：右侧容器（结果展示 / 业务面板） -->
    <div v-show="showPanels" class="right-container" :style="rightContainerStyle">
      <slot name="right">
        <div class="zone zone-4" :style="zoneSize">
          <Zone4 />
        </div>
      </slot>
    </div>

    <!-- 第四层：底部业务导航 -->
    <BottomNavBar />
  </div>
</template>

<style scoped>
.app-layout {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 50;
}

.left-container > *,
.right-container > * {
  pointer-events: auto;
}

.zone {
  position: relative;
  box-sizing: border-box;
  padding: v-bind(zonePadding);
  pointer-events: auto;
}
</style>
