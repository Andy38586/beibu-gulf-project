<template>
  <div class="empty-state">
    <p class="empty-state__message">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * EmptyState — 统一空数据占位组件（c029）
 *
 * 全项目空状态共用，避免各图表/列表各自拼写"暂无数据"。
 * 样式直接使用全局 --GCS-* 设计变量（不引入 useGCS，避免 shared → core 反向依赖）。
 */
withDefaults(defineProps<{ message?: string }>(), {
  message: '暂无数据',
})
</script>

<style scoped>
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 64px;
  color: var(--GCS-text-muted, #909399);
  font-size: 13px;
  letter-spacing: 0.02em;
}

.empty-state__message {
  margin: 0;
}
</style>
