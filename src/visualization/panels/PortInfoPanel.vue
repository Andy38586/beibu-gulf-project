<script setup lang="ts">
/**
 * PortInfoPanel - 港口信息展示面板
 *
 * 功能：显示选中港口的详细信息（地址、电话、类型、经纬度）
 *
 * 布局：绝对定位，右上角
 */
import { computed } from 'vue'
import { useGCS } from '@/core/layout/useGCS.js'

interface Props {
  selectedPort?: Record<string, unknown>
}

defineProps<Props>()

const { cellPixel } = useGCS()
const unitPx = computed(() => cellPixel.value * 0.1)
</script>

<template>
  <div class="port-info-panel" v-if="selectedPort">
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
  z-index: 55;
  background: rgba(255, 255, 255, 0.95);
  border-radius: calc(1.25 * v-bind(unitPx));
  box-shadow: 0 calc(0.5 * v-bind(unitPx)) calc(2.25 * v-bind(unitPx)) rgba(0, 0, 0, 0.2);
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
  color: var(--gcs-text-regular);
}
.info-item {
  font-size: calc(1.75 * v-bind(unitPx));
  color: var(--gcs-text-regular);
  line-height: 1.4;
}
</style>
