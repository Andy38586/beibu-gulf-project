<script>
export default { name: 'GcsZone1' }
</script>

<script setup>
/**
 * Zone1 - 业务控制区（右上）
 *
 * 职责：承载全局导航（Home / User）+ 城市定位 + 业务入口按钮。
 * 当前阶段完成 AppHeader 拆解后的全局导航与城市定位，业务入口保持占位，
 * 真实业务路由跳转由 Phase 3-B 业务控制面板统一替换。
 */

import GcsPanel from './GcsPanel.vue'
import GcsButton from './GcsButton.vue'
import CityBar from './CityBar.vue'
import { useScreenActions } from '@/composables/useScreenActions.js'
import { GAP } from '../config.js'

const { goHome, goProfileOrBack, userButtonLabel, flyToCity } = useScreenActions()
</script>

<template>
  <GcsPanel :w="4" :h="4" class="zone-business">
    <div class="zone1-grid" :style="{ gap: `${GAP}px` }">
      <!-- 第一行：Home + User -->
      <div class="row" :style="{ gap: `${GAP}px` }">
        <GcsButton label="首页" icon="⌂" @click="goHome" />
        <GcsButton :label="userButtonLabel" icon="👤" @click="goProfileOrBack" />
      </div>

      <!-- 第二行：城市定位横条 -->
      <CityBar @select="flyToCity" />

      <!-- 第三至第四行：业务入口占位（Phase 3-B 统一实现） -->
      <div class="row" :style="{ gap: `${GAP}px` }">
        <GcsButton label="选址分析" icon="◈" />
        <GcsButton label="吞吐量" icon="📊" disabled />
      </div>
      <div class="row" :style="{ gap: `${GAP}px` }">
        <GcsButton label="因子" icon="⚐" disabled />
        <GcsButton label="更多" icon="⋯" disabled />
      </div>
    </div>
  </GcsPanel>
</template>

<style scoped>
.zone-business {
  width: 100%;
  height: 100%;
}

.zone1-grid {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

.row {
  display: flex;
  flex: none;
}
</style>
