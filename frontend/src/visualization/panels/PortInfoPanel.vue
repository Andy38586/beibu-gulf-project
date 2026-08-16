<script setup lang="ts">
/** 港口信息展示面板：显示选中港口的地址、电话、类型、经纬度。绝对定位，右上角 */
import { computed } from 'vue'

import { useGCS } from '@/shared'
// 816-专项3-0816-15：窄接口替代 Record<string, unknown>（模板直访 .name/.address/.phone/.type/.lng/.lat 全部收窄）
import type { Port } from '@/types'

interface Props {
  selectedPort?: Port | null
}

defineProps<Props>()

const { cellPixel } = useGCS()
const unitPx = computed(() => cellPixel.value * 0.1)
</script>

<template>
  <div v-if="selectedPort" class="port-info-panel">
    <h2>{{ selectedPort.name }}</h2>
    <div class="info-item">
      <span>📍 地址：</span>
      <span>{{ selectedPort.address || '暂无' }}</span>
    </div>
    <div class="info-item">
      <span>📞 电话：</span>
      <span>{{ selectedPort.phone || '暂无' }}</span>
    </div>
    <div class="info-item">
      <span>🏷️ 类型：</span>
      <span>{{ selectedPort.type || '未知' }}</span>
    </div>
    <div class="info-item">
      <span>🌐 经纬度：</span>
      <span>{{ selectedPort.lng }}, {{ selectedPort.lat }}</span>
    </div>
  </div>
</template>

<style scoped>
.port-info-panel {
  position: absolute;
  top: calc(8.5 * v-bind(unitPx));
  right: calc(1.5 * v-bind(unitPx));
  width: calc(35 * v-bind(unitPx));
  z-index: var(--GCS-z-panel-float); /* 816-S7-40：浮动面板档（原散落 55，被 nav 60 语义盖过） */
  background: var(--GCS-bg-panel-translucent);
  border-radius: var(--GCS-radius-md); /* 816-S7-55：calc 非档位圆角归 md（面板默认档） */

  /* 面板阴影：随 unitPx 响应缩放（固定 px 的 --GCS-shadow-* 会破坏响应式尺寸），故保留原值 */
  box-shadow: 0 calc(0.5 * v-bind(unitPx)) calc(2.25 * v-bind(unitPx)) rgb(0 0 0 / 20%);
  padding: calc(1.5 * v-bind(unitPx));
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: v-bind(unitPx);
}

.port-info-panel h2 {
  margin: 0;
  font-size: calc(2.25 * v-bind(unitPx));
  color: var(--GCS-text-regular);
}

.info-item {
  font-size: calc(1.75 * v-bind(unitPx));
  color: var(--GCS-text-regular);
  line-height: 1.4;
}
</style>
