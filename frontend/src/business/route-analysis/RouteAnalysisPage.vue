<script setup lang="ts">
/**
 * 航线分析业务页（T5.3）：
 * 地图点击拾取起终点 → 调 /route/path（FastAPI algorithm-service）→ 路径线图层 + 里程/时长面板。
 * 双引擎（2D/3D）均可用：图层走 BLM（注册即双引擎通用），点击经渲染器 click 事件回传坐标。
 * 断链语义（专项8 7.2）：不可达/未吸附为合法空结果（提示原因），错误态（网络/503）单独区分。
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'

import { AppLayout, GCSPanel, LayerControlPanel, useBusinessLayers, useMapControls } from '@/core'
import { logger, showError, showWarning } from '@/shared'
import type { RoutePathResponse } from '@/types'

import { useRouteApi } from './composables/useRouteApi'
import {
  ROUTE_ENDPOINT_LAYER_ID,
  ROUTE_PATH_LAYER_ID,
  useRouteLayer,
} from './composables/useRouteLayer'

const { mapInstance } = useMapControls()
const { manager: businessLayerManager } = useBusinessLayers()
const { queryPath, calculating } = useRouteApi()
const { updateRouteLayers, clearRouteLayers: clearLayers } = useRouteLayer()

/** 拾取阶段：none=不拾取 / from=下一次点击设起点 / to=下一次点击设终点 */
type PickStage = 'none' | 'from' | 'to'

const pickStage = ref<PickStage>('none')
const from = ref<{ lng: number; lat: number } | null>(null)
const to = ref<{ lng: number; lat: number } | null>(null)
const mode = ref<'distance' | 'time'>('distance')
const result = ref<RoutePathResponse | null>(null)
const resultError = ref('')
const clickListenerRef = ref<
  ((event: CustomEvent<{ coordinate: [number, number] | null }>) => void) | null
>(null)

const canQuery = computed(() => from.value !== null && to.value !== null)

/** 面板展示行（成功结果 → 里程/时长；空结果 → 原因文案） */
const summaryText = computed(() => {
  if (!result.value) return ''
  if (!result.value.found) {
    const reasons: Record<string, string> = {
      origin_not_snapped: '起点未吸附到路网（离道路过远）',
      destination_not_snapped: '终点未吸附到路网（离道路过远）',
      unreachable: '起终点间不可达（路网断链）',
    }
    return reasons[result.value.reason] ?? '未找到可达路径'
  }
  return `里程 ${result.value.distanceM.toFixed(1)} km · 约 ${result.value.durationMin.toFixed(1)} 分`
})

/** 累加接驳距离（后端只报路网边里程，起终点接入段单独透出） */
const totalDistanceText = computed(() => {
  if (!result.value || !result.value.found) return ''
  const snap = result.value.snapDistanceM
  const total = result.value.distanceM + snap.from + snap.to
  return `含接驳共 ${total.toFixed(1)} km（起点接 ${snap.from.toFixed(0)} m / 终点接 ${snap.to.toFixed(0)} m）`
})

/** 地图点击拾取：渲染器 click 事件（命中要素或空白区均回传坐标） */
function handlePick(): void {
  const renderer = mapInstance.value?.getRenderer?.()
  if (!renderer) return
  const listener = (event: CustomEvent<{ coordinate: [number, number] | null }>) => {
    const coordinate = event.detail?.coordinate
    if (!coordinate || !Array.isArray(coordinate) || coordinate.length < 2) return
    const lng = Number(coordinate[0])
    const lat = Number(coordinate[1])
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
    if (pickStage.value === 'from') {
      from.value = { lng, lat }
      pickStage.value = 'none'
      logger.debug('[RouteAnalysis] 起点已拾取:', from.value)
    } else if (pickStage.value === 'to') {
      to.value = { lng, lat }
      pickStage.value = 'none'
      logger.debug('[RouteAnalysis] 终点已拾取:', to.value)
    }
    // 每次拾取后重绘端点标记
    updateRouteLayers(
      businessLayerManager,
      result.value?.found ? result.value : null,
      from.value,
      to.value
    )
  }
  renderer.on('click', listener)
  clickListenerRef.value = listener
}

/** 发起查询 */
async function handleQuery(): Promise<void> {
  if (!from.value || !to.value) {
    showWarning('请先在地图上拾取起点和终点')
    return
  }
  resultError.value = ''
  try {
    const resp = await queryPath({
      fromLng: from.value.lng,
      fromLat: from.value.lat,
      toLng: to.value.lng,
      toLat: to.value.lat,
      mode: mode.value,
    })
    result.value = resp
    if (!resp.found) {
      const reasons: Record<string, string> = {
        origin_not_snapped: '起点未吸附到路网（离道路过远），请靠近道路拾取',
        destination_not_snapped: '终点未吸附到路网（离道路过远），请靠近道路拾取',
        unreachable: '起终点之间当前无法连通（路网断链）',
      }
      showWarning(reasons[resp.reason] ?? '未找到可达路径')
    }
    updateRouteLayers(businessLayerManager, resp.found ? resp : null, from.value, to.value)
  } catch (error) {
    const msg = error instanceof Error ? error.message : '路径查询失败'
    resultError.value = msg
    showError(msg, { fallback: '路径查询失败，请稍后重试' })
    result.value = null
    updateRouteLayers(businessLayerManager, null, from.value, to.value)
  }
}

/** 清除起终点与路径 */
function handleClear(): void {
  from.value = null
  to.value = null
  result.value = null
  resultError.value = ''
  pickStage.value = 'none'
  clearLayers(businessLayerManager)
}

/** 起点/终点拾取按钮点击（角色互斥：拾起点时终点的下一击无效） */
function startPickFrom(): void {
  pickStage.value = pickStage.value === 'from' ? 'none' : 'from'
}
function startPickTo(): void {
  pickStage.value = pickStage.value === 'to' ? 'none' : 'to'
}

// 地图点击监听只挂一次；renderer 在引擎切换后可能被重建，路由切换时由 App 解绑旧实例
onMounted(handlePick)

onUnmounted(() => {
  // 解绑渲染器 click 监听（与 onMounted 配对；引擎切换/路由离开不留泄漏）
  const renderer = mapInstance.value?.getRenderer?.()
  if (renderer && clickListenerRef.value) {
    renderer.off?.('click', clickListenerRef.value)
    clickListenerRef.value = null
  }
  clearLayers(businessLayerManager)
})
</script>

<template>
  <div class="route-analysis-page">
    <AppLayout>
      <!-- 左下：路径控制与结果面板 -->
      <template #left>
        <GCSPanel :w="4" :h="6" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <div class="route-panel">
            <h3 class="route-title">航线路径</h3>

            <button
              class="pick-btn"
              :class="{ active: pickStage === 'from' }"
              @click="startPickFrom"
            >
              {{
                pickStage === 'from'
                  ? '点击地图设置起点…'
                  : from
                    ? `起点 ${from.lng.toFixed(4)}, ${from.lat.toFixed(4)}`
                    : '拾取起点'
              }}
            </button>
            <button class="pick-btn" :class="{ active: pickStage === 'to' }" @click="startPickTo">
              {{
                pickStage === 'to'
                  ? '点击地图设置终点…'
                  : to
                    ? `终点 ${to.lng.toFixed(4)}, ${to.lat.toFixed(4)}`
                    : '拾取终点'
              }}
            </button>

            <div class="mode-row">
              <button
                class="mode-btn"
                :class="{ active: mode === 'distance' }"
                @click="mode = 'distance'"
              >
                最短距离
              </button>
              <button class="mode-btn" :class="{ active: mode === 'time' }" @click="mode = 'time'">
                最快时间
              </button>
            </div>

            <div class="action-row">
              <button class="query-btn" :disabled="!canQuery || calculating" @click="handleQuery">
                {{ calculating ? '查询中…' : '查询路径' }}
              </button>
              <button class="clear-btn" @click="handleClear">清除</button>
            </div>

            <div v-if="resultError" class="result-error">{{ resultError }}</div>
            <div v-else-if="result" class="result-summary">
              <div class="summary-main">{{ summaryText }}</div>
              <div v-if="result.found" class="summary-sub">{{ totalDistanceText }}</div>
            </div>
            <div v-else class="result-hint">按「拾取起点/终点」后点击地图选择位置</div>
          </div>
        </GCSPanel>
      </template>

      <!-- 右下：图层控制 -->
      <template #right>
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

.route-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  color: var(--GCS-text-primary, #ddd);
}

.route-title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--GCS-text-primary, #ddd);
}

.pick-btn,
.mode-btn,
.query-btn,
.clear-btn {
  border: 1px solid var(--GCS-border, #3a4b5c);
  background: var(--GCS-bg-elevated, #1e2a38);
  color: var(--GCS-text-primary, #ddd);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.pick-btn:hover,
.mode-btn:hover {
  background: var(--GCS-bg-hover, #2a3a4a);
}

.pick-btn.active,
.mode-btn.active {
  border-color: var(--GCS-color-primary, #3b82f6);
  color: var(--GCS-color-primary, #3b82f6);
}

.mode-row,
.action-row {
  display: flex;
  gap: 8px;
}

.query-btn {
  flex: 1;
}

.query-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.result-summary {
  padding: 8px 10px;
  background: var(--GCS-bg-elevated, #1e2a38);
  border-radius: 4px;
}

.summary-main {
  font-size: 13px;
  font-weight: 600;
  color: var(--GCS-color-primary, #3b82f6);
}

.summary-sub {
  margin-top: 4px;
  font-size: 11px;
  color: var(--GCS-text-muted, #8899aa);
}

.result-error {
  padding: 8px 10px;
  color: #f87171;
  font-size: 12px;
  background: var(--GCS-bg-elevated, #1e2a38);
  border-radius: 4px;
}

.result-hint {
  color: var(--GCS-text-muted, #667788);
  font-size: 12px;
  padding: 4px 0;
}
</style>
