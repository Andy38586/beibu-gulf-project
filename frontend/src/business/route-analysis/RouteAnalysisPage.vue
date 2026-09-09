<script setup lang="ts">
/**
 * 航线分析业务页（Cesium 引擎驱动）：
 * 控制面板（右上图层控制上方 4×4）选点 → 逐段调 /route/path（FastAPI algorithm-service）→
 * 多段路径线 + 端点标记图层；左栏为结果摘要面板。
 * 选点双入口：POI 搜索（Nest /site-analysis/pois）或地图点击（限钦北防三市，见 RouteControlPanel）。
 * 引擎固定 3D（Cesium）：由路由 meta.engine='3d' 经 App 路由守卫统一驱动，本页不再自行切换/还原，
 * 与浸没分析一致——同为 3D 的路由互切时 UnifiedMap 直接复用同一 Viewer，不卸载、不重建上下文。
 * 路径线/端点图层走 BLM 注册（双引擎通用，本页不再暴露 OL 链路）。
 */
import { ref, watch } from 'vue'

import { AppLayout, GCSPanel, LayerControlPanel, useBusinessLayers } from '@/core'
import { logger } from '@/shared'
import { useMapStore } from '@/stores'
import type { RoutePathResult } from '@/types'

import { ROUTE_ENDPOINT_LAYER_ID, ROUTE_PATH_LAYER_ID } from './composables/useRouteLayer'
import RouteControlPanel from './components/RouteControlPanel.vue'

const mapStore = useMapStore()
const { manager: businessLayerManager } = useBusinessLayers()

/** 查询摘要（panel emit 汇聚；null = 尚无结果） */
const summary = ref<{
  totalKm: number
  totalMin: number
  segCount: number
  totalWithSnapKm: number
} | null>(null)

function handleQueryResult(payload: { segments: RoutePathResult[]; pointCount: number }): void {
  const { segments, pointCount } = payload
  const netM = segments.reduce((s, seg) => s + seg.distanceM, 0)
  const snapM = segments.reduce((s, seg) => s + seg.snapDistanceM.from + seg.snapDistanceM.to, 0)
  summary.value = {
    // 主行只合计路网里程；接驳单独透出（多段时接驳含段间吸附往返，不与路网里程混算）
    totalKm: netM / 1000,
    totalMin: segments.reduce((s, seg) => s + seg.durationMin, 0),
    segCount: segments.length,
    totalWithSnapKm: (netM + snapM) / 1000,
  }
  logger.debug(`[RouteAnalysis] 查询完成: ${segments.length} 段 / ${pointCount} 点`)
}

function handleCleared(): void {
  summary.value = null
}

// ---- 地图点击 → 面板选点（渲染器 click 事件；命中要素或空白区均回传坐标） ----

const panelRef = ref<InstanceType<typeof RouteControlPanel> | null>(null)

function handleRendererClick(event: CustomEvent<{ coordinate: [number, number] | null }>): void {
  const coordinate = event.detail?.coordinate
  if (!coordinate || !Array.isArray(coordinate) || coordinate.length < 2) return
  const lng = Number(coordinate[0])
  const lat = Number(coordinate[1])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
  void panelRef?.value?.handleMapPick(lng, lat)
}

// 拾取监听跟随渲染器实例全生命周期（onMounted 一次性注册有两个丢失窗口：
// ①渲染器异步初始化晚于挂载时 getRenderer() 为 null 静默 return；
// ②引擎切换重建渲染器后旧监听随旧实例销毁、新实例无监听——拾取永久失效。
// watch mapStore.currentRenderer 同时覆盖初次就绪与切换重建，immediate 兜挂载前就绪）
watch(
  () => mapStore.currentRenderer,
  (renderer, old) => {
    old?.off?.('click', handleRendererClick)
    renderer?.on?.('click', handleRendererClick)
  },
  { immediate: true }
)
</script>

<template>
  <div class="route-analysis-page">
    <AppLayout>
      <!-- 左下：路径结果摘要面板 -->
      <template #left>
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <div class="result-panel">
            <h3 class="panel-title">路径结果</h3>
            <template v-if="summary">
              <div class="summary-main">{{ summary.totalKm.toFixed(1) }} km</div>
              <div class="summary-sub">
                约 {{ summary.totalMin.toFixed(1)}} 分钟 · {{ summary.segCount }} 段
              </div>
              <div class="summary-sub">含接驳 {{ summary.totalWithSnapKm.toFixed(1) }} km</div>
            </template>
            <div v-else class="result-hint">
              在右侧面板选择起点与终点后点击「开始查询」；途径点可选（最多 2 个）
            </div>
            <button class="clear-btn" @click="panelRef?.handleClear()">清除全部</button>
          </div>
        </GCSPanel>
      </template>

      <!-- 右下：图层控制 -->
      <template #right>
        <RouteControlPanel ref="panelRef" :manager="businessLayerManager" @query-result="handleQueryResult" @cleared="handleCleared" />
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel
            :layer-order="[
              'base-image',
              'base-vector',
              'boundary',
              ROUTE_PATH_LAYER_ID,
              ROUTE_ENDPOINT_LAYER_ID,
            ]"
          />
        </GCSPanel>
      </template>
    </AppLayout>
  </div>
</template>

<style scoped>
.route-analysis-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.result-panel {
  padding: 12px;
  color: var(--GCS-text-primary);
}

.panel-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--GCS-text-primary);
}

.summary-main {
  font-size: 20px;
  font-weight: 600;
  color: var(--GCS-color-primary);
}

.summary-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--GCS-text-regular);
}

.summary-hint {
  margin-top: 8px;
  font-size: 10px;
  color: var(--GCS-text-muted);
}

.result-hint {
  color: var(--GCS-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.clear-btn {
  margin-top: 12px;
  padding: 4px 10px;
  border: 1px solid var(--GCS-border-default);
  border-radius: 4px;
  background: var(--GCS-bg-elevated);
  color: var(--GCS-text-regular);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.clear-btn:hover {
  border-color: var(--GCS-color-primary);
  color: var(--GCS-color-primary);
}
</style>
