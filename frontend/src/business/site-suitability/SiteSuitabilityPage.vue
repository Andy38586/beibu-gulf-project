<!--
  新选址适宜性页（单元五）：右控制面板（五准则权重滑块）+ 地图热力图层。
  链路复刻预测页：状态变化 → 防抖 300ms → 启动事务（取消旧请求）→ 图层更新。
-->
<script setup lang="ts">
import { onUnmounted, watch } from 'vue'

import { AppLayout, GCSPanel, LayerControlPanel } from '@/core'
import { logger, useProfileSnapshot } from '@/shared'
import { useMapStore } from '@/stores'
import { useSiteSuitabilityStore } from '@/stores'

import SiteSuitabilityControlPanel from './components/SiteSuitabilityControlPanel.vue'
import { useSiteSuitabilityLayer } from './composables/useSiteSuitabilityLayer'
import { useSiteSuitabilityRequest } from './composables/useSiteSuitabilityRequest'

const mapStore = useMapStore()
const state = useSiteSuitabilityStore()
const { updateLayer, renderer } = useSiteSuitabilityLayer()
const { startTransaction, cancelAll } = useSiteSuitabilityRequest()

let debounceTimer: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_DELAY = 300

// 跳转个人中心（登录）时清空交互态（无快照需求——权重为实验性交互）
useProfileSnapshot({
  save: () => undefined,
  clear: () => state.reset(),
})

async function doUpdate() {
  if (!renderer.value) return
  const { transactionId, signal } = startTransaction()
  await updateLayer(transactionId, signal)
}

watch(
  () => mapStore.currentRenderer,
  (r) => {
    if (r) {
      logger.debug('[SiteSuitabilityPage] renderer ready, loading...')
      void doUpdate()
    }
  },
  { immediate: true }
)

// 权重/过滤变化 → 防抖 300ms 统一刷新（复刻 ForecastPage 合并监听模式）
watch(
  () => [...Object.values(state.weights), state.minLandFrac],
  () => {
    clearTimeout(debounceTimer ?? undefined)
    debounceTimer = setTimeout(() => doUpdate(), DEBOUNCE_DELAY)
  }
)

onUnmounted(() => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  cancelAll()
  state.reset()
})
</script>

<template>
  <div class="ss-page">
    <AppLayout>
      <template #right>
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <SiteSuitabilityControlPanel />
        </GCSPanel>
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel />
        </GCSPanel>
      </template>
    </AppLayout>
  </div>
</template>

<style scoped>
.ss-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.ss-page :deep(.GCS-panel) {
  pointer-events: auto;
}
</style>
