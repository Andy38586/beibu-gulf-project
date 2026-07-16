<script>
export default { name: 'GcsZone1' }
</script>

<script setup>
/**
 * Zone1 - 业务控制区（右上）
 *
 * 职责：承载全局导航（Home / User）+ 城市定位 + 业务入口按钮。
 * Phase 3-B：业务入口已接入路由，仅选址分析可用，其余未来业务置为禁用态。
 */

import { computed } from 'vue'
import { useRouter } from 'vue-router'
import GcsPanel from './GcsPanel.vue'
import GcsButton from './GcsButton.vue'
import CityBar from './CityBar.vue'
import { useScreenActions } from '@/shared/composables/useScreenActions.js'
import { GAP } from '../config.js'

const { goHome, goProfileOrBack, userButtonLabel, flyToCity } = useScreenActions()
const router = useRouter()

/**
 * 业务入口配置
 * - 仅选址分析已存在路由，其余为禁用态（未来业务）
 * - 顺序按 act 文档：选址 / 吞吐量 / 因子 / 航线
 */
const businessEntries = computed(() => [
  { label: '选址分析', icon: '◈', route: '/site-selection', disabled: false },
  { label: '吞吐量', icon: '📊', route: '', disabled: true },
  { label: '因子', icon: '⚐', route: '', disabled: true },
  { label: '航线分析', icon: '✈', route: '', disabled: true },
])

function handleBusinessClick(entry) {
  if (entry.disabled || !entry.route) return
  router.push(entry.route)
}
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

      <!-- 第三至第四行：业务入口 -->
      <div
        v-for="(pair, rowIndex) in [
          [businessEntries[0], businessEntries[1]],
          [businessEntries[2], businessEntries[3]],
        ]"
        :key="rowIndex"
        class="row"
        :style="{ gap: `${GAP}px` }"
      >
        <GcsButton
          v-for="entry in pair"
          :key="entry.label"
          :label="entry.label"
          :icon="entry.icon"
          :disabled="entry.disabled"
          @click="handleBusinessClick(entry)"
        />
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
