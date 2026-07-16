<script>
export default { name: 'GcsTitlePanel' }
</script>

<script setup>
/**
 * TitlePanel - 顶部路由名称面板
 *
 * 职责：
 * 1. 显示当前路由的 meta.title
 * 2. 作为 TopArea 左侧的 4×1 Panel
 * 3. 字号随 CELL_PIXEL 动态缩放
 *
 * Props:
 * - title: 标题文字，默认从 route.meta.title 读取
 */

import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useGCS } from '../useGCS.js'
import GcsPanel from './GcsPanel.vue'

const props = defineProps({
  title: { type: String, default: '' },
})

const route = useRoute()
const { cellPixel } = useGCS()

const displayTitle = computed(() => props.title || route.meta?.title || '北部湾港口GIS')

const titleStyle = computed(() => ({
  fontSize: `${cellPixel.value * 0.25}px`,
  fontWeight: 600,
  lineHeight: 1.2,
}))
</script>

<template>
  <GcsPanel :w="4" :h="1" class="title-panel">
    <div class="title-inner" :style="titleStyle">
      {{ displayTitle }}
    </div>
  </GcsPanel>
</template>

<style scoped>
.title-panel {
  width: 100%;
  height: 100%;
}

.title-inner {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 8px;
  box-sizing: border-box;
}
</style>
