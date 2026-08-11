<script setup lang="ts">
/** PanelTitle — 通用面板标题：字号随 cell 单位缩放（0.4 cell），全站面板统一使用，只传 title 即可 */
import { computed } from 'vue'

import { useGCS } from '@/shared/layout/useGCS.js'

const { css, cellPixel } = useGCS()
const { cell8px } = css

/** 标题字号 = 0.4 cell，适配 1 cell 高的标题面板 */
const titleFontSize = computed(() => `${cellPixel.value * 0.4}px`)

interface Props {
  title?: string
}

withDefaults(defineProps<Props>(), {
  title: '',
})
</script>

<template>
  <div class="panel-title">
    <span class="panel-title-text">{{ title }}</span>
  </div>
</template>

<style scoped>
.panel-title {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: v-bind(cell8px) 0;
}

.panel-title-text {
  font-size: v-bind(titleFontSize);
  font-weight: 600;
  color: var(--GCS-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
