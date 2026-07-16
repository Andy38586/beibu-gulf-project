<script>
export default { name: 'GcsZone3' }
</script>

<script setup>
/**
 * Zone3 - 图层控制区（左下）
 *
 * 职责：承载底图切换、业务图层开关等图层控制按钮。
 * 当前阶段先用 GcsButton 占位，内部内容由 Phase 5 图层控制面板替换。
 */

import GcsPanel from './GcsPanel.vue'
import GcsButton from './GcsButton.vue'
import { GAP } from '../config.js'
</script>

<template>
  <GcsPanel :w="4" :h="4" class="zone-layer">
    <div class="button-grid" :style="{ gap: `${GAP}px` }">
      <GcsButton label="影像底图" icon="🗺" />
      <GcsButton label="矢量底图" icon="🗺" />
      <GcsButton label="港口图层" icon="⚓" />
      <GcsButton label="航线图层" icon="✈" />
    </div>
  </GcsPanel>
</template>

<style scoped>
.zone-layer {
  width: 100%;
  height: 100%;
}

.button-grid {
  width: 100%;
  height: 100%;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
}
</style>
