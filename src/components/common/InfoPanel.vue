<script setup>
defineProps({
  selectedPort: Object,
})
</script>

<template>
  <div class="info-panel" v-if="selectedPort">
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
      <span>{{ selectedPort.lon }}, {{ selectedPort.lat }}</span>
    </div>
  </div>
</template>

<style scoped>
.info-panel {
  position: absolute;
  top: calc(8.5 * var(--unit));
  right: calc(1.5 * var(--unit));
  width: calc(35 * var(--unit));
  z-index: 55;
  background: rgba(255, 255, 255, 0.95);
  border-radius: calc(1.25 * var(--unit));
  box-shadow: 0 calc(0.5 * var(--unit)) calc(2.25 * var(--unit)) rgba(0, 0, 0, 0.2);
  padding: calc(1.5 * var(--unit));
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--unit);
}
.info-panel h2 {
  margin: 0;
  font-size: 18px;
  color: #333;
}
.info-item {
  font-size: 14px;
  color: #444;
  line-height: 1.4;
}
</style>
