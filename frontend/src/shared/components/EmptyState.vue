<template>
  <div class="empty-state">
    <div v-if="icon" class="empty-state__icon" aria-hidden="true">{{ icon }}</div>
    <p class="empty-state__message">{{ message }}</p>
    <p v-if="hint" class="empty-state__hint">{{ hint }}</p>
    <div v-if="$slots.action" class="empty-state__action">
      <slot name="action" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 统一空数据占位组件（c057）：全项目共用，避免各图表/列表各自拼写"暂无数据"；
 * 支持 icon / hint / action 插槽，替代各页面内联空态；
 * 直接用全局 --GCS-* 变量，避免 shared → core 反向依赖。
 */
withDefaults(
  defineProps<{
    message?: string
    /** 引导文案（如"去选址分析收藏内容吧"），无则不渲染 */
    hint?: string
    /** 引导图标（emoji 或字符），无则不渲染 */
    icon?: string
  }>(),
  {
    message: '暂无数据',
    hint: '',
    icon: '',
  }
)
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  min-height: 64px;
  color: var(--GCS-text-muted);
  font-size: 13px;
  letter-spacing: 0.02em;
  text-align: center;
  padding: 12px;
  box-sizing: border-box;
}

.empty-state__icon {
  font-size: 28px;
  line-height: 1;
}

.empty-state__message {
  margin: 0;
  color: var(--GCS-text-muted); /* 与升级前一致，不改变主文案视觉层级 */
  font-size: 13px;
}

.empty-state__hint {
  margin: 0;
  font-size: 12px;
}

.empty-state__action {
  margin-top: 4px;
}
</style>
