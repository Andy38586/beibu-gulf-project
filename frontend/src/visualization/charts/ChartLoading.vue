<script setup lang="ts">
/**
 * ChartLoading - 图表异步加载占位（echarts 异步化后，图表 chunk 未就绪时显示）
 * 仅作布局占位，不承载业务逻辑；加载完成由异步组件替换。
 */
</script>

<template>
  <div class="chart-loading" role="status" aria-label="图表加载中">
    <div class="chart-loading__spinner"></div>
    <span class="chart-loading__text">图表加载中…</span>
  </div>
</template>

<style scoped>
.chart-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--GCS-text-muted, #909399);
  font-size: 12px;
}

.chart-loading__spinner {
  width: 24px;
  height: 24px;
  border: 3px solid var(--GCS-bg-panel, #fff);
  border-top-color: var(--GCS-color-primary, #409eff);
  border-radius: 50%;
  animation: chart-loading-spin 0.8s linear infinite;
}

@keyframes chart-loading-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
