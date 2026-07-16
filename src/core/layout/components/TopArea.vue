<script>
export default { name: 'GcsTopArea' }
</script>

<script setup>
/**
 * TopArea - 顶部功能区
 *
 * 职责：
 * 1. 左侧显示当前路由名称（TitlePanel）
 * 2. 右侧提供城市定位按钮（钦州 / 北海 / 防城港）和用户状态按钮
 * 3. 位置固定于视口顶部，与地图叠加
 *
 * 设计说明：
 * - 顶部区域仅承载全局导航与城市定位，不放置业务入口
 * - 业务入口统一迁移至 BottomNavBar
 * - 所有按钮均使用 1×1 NavButton，保持视觉统一
 */

import TitlePanel from './TitlePanel.vue'
import NavButton from './NavButton.vue'
import { useScreenActions } from '@/shared/composables/useScreenActions.js'
import { GAP } from '../config.js'

const { goProfileOrBack, userButtonLabel, flyToCity } = useScreenActions()

const cityButtons = [
  { label: '钦州', city: '钦州' },
  { label: '北海', city: '北海' },
  { label: '防城港', city: '防城港' },
]

function handleCityClick(city) {
  flyToCity(city)
}
</script>

<template>
  <div class="top-area" :style="{ gap: `${GAP}px` }">
    <!-- 左侧：路由名称 -->
    <div class="top-area-left">
      <slot name="title">
        <TitlePanel />
      </slot>
    </div>

    <!-- 右侧：城市定位 + 用户 -->
    <div class="top-area-right" :style="{ gap: `${GAP}px` }">
      <slot name="actions">
        <NavButton
          v-for="item in cityButtons"
          :key="item.city"
          :label="item.label"
          @click="handleCityClick(item.city)"
        />
        <NavButton
          :label="userButtonLabel"
          icon="👤"
          @click="goProfileOrBack"
        />
      </slot>
    </div>
  </div>
</template>

<style scoped>
.top-area {
  position: absolute;
  top: 20px;
  left: 20px;
  right: 20px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  pointer-events: none;
  z-index: 60;
}

.top-area-left,
.top-area-right {
  pointer-events: auto;
  display: flex;
}

.top-area-left {
  flex: none;
}

.top-area-right {
  flex: none;
}
</style>
