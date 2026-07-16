<script setup>
/**
 * AppLayout - GCS 布局基座（Layout Base）
 *
 * 职责：
 * 1. 定义四象限 Zone 布局（左上/右上/左下/右下）
 * 2. 基于 CELL_PIXEL 计算 Zone 位置与尺寸
 * 3. 提供 zone1 / zone2 / zone3 / zone4 四个插槽
 *
 * 使用方式：
 * <AppLayout>
 *   <template #zone1>业务控制区</template>
 *   <template #zone2>可视化区</template>
 *   <template #zone3>图层控制区</template>
 *   <template #zone4>结果展示区</template>
 * </AppLayout>
 */

import { computed } from 'vue'
import { useGCS } from './useGCS.js'
import Zone1 from './components/Zone1.vue'
import Zone2 from './components/Zone2.vue'
import Zone3 from './components/Zone3.vue'
import Zone4 from './components/Zone4.vue'

const { cell, padding } = useGCS()

// 每个 Zone 固定占 4×4 个 Cell
const zoneSize = computed(() => cell(4, 4))

// Zone 内边距 = CELL_PADDING，确保内部 Panel 不贴边
const zonePadding = computed(() => `${padding.value}px`)

// 所有 Zone 统一尺寸
const zoneStyle = computed(() => ({
  width: zoneSize.value.width,
  height: zoneSize.value.height,
}))
</script>

<template>
  <div class="app-layout">
    <!-- Zone1：右上，业务控制区 -->
    <div class="zone zone-1" :style="zoneStyle">
      <slot name="zone1">
        <Zone1 />
      </slot>
    </div>

    <!-- Zone2：左上，可视化区 -->
    <div class="zone zone-2" :style="zoneStyle">
      <slot name="zone2">
        <Zone2 />
      </slot>
    </div>

    <!-- Zone3：左下，图层控制区 -->
    <div class="zone zone-3" :style="zoneStyle">
      <slot name="zone3">
        <Zone3 />
      </slot>
    </div>

    <!-- Zone4：右下，结果展示区 -->
    <div class="zone zone-4" :style="zoneStyle">
      <slot name="zone4">
        <Zone4 />
      </slot>
    </div>
  </div>
</template>

<style scoped>
.app-layout {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 50;
}

.zone {
  position: absolute;
  box-sizing: border-box;
  padding: v-bind(zonePadding);
  pointer-events: auto;
}

.zone-1 {
  top: 0;
  right: 0;
}

.zone-2 {
  top: 0;
  left: 0;
}

.zone-3 {
  bottom: 0;
  left: 0;
}

.zone-4 {
  bottom: 0;
  right: 0;
}
</style>
