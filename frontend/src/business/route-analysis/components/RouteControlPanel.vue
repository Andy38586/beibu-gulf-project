<script setup lang="ts">
/**
 * 航线分析控制面板（图层控制面板上方 4×4 槽位）：
 * 顶行「查询 POI」（3.8 宽通栏）→ 弹出 POI 列表，点选填入激活槽并飞行定位；
 * 中部四个 1.8 宽槽位按钮（起点/途径1/途径2/终点，途径可空）——
 *   按钮主体 = 打开 POI 选择；右侧定位图标 = 地图选点模式（悬浮提示），仅限钦北防三市；
 * 底行「开始查询」（3.8 宽主按钮）→ 按起点→途径→终点链逐段查询（后端 /route/path 单段），
 *   段折线全部上图，总里程/时长 emit 给页面结果面板。
 * 按钮规格对齐 SiteAnalysisControlPanel：2×1.8fr grid、0.8cell 行高、token 全走 --GCS-*。
 */
import { computed, onUnmounted, ref } from 'vue'

import { GCSPanel } from '@/core'
import { logger, showError, showWarning, useGCS } from '@/shared'
import { useMapStore } from '@/stores'
import type { PoiSearchItemParsed } from '@/types/schemas'
import type { RoutePathResult } from '@/types'

import { isWithinThreeCities } from '../composables/useCityBoundary'
import { ROUTE_SLOT_KEYS, useRouteLayer } from '../composables/useRouteLayer'
import type { RouteLayerManager, RoutePoint, RouteSlot, RouteSlotKey } from '../composables/useRouteLayer'
import { RouteQueryCancelledError, useRouteApi } from '../composables/useRouteApi'

interface Props {
  /** BLM 实例（图层注册/更新；页面 useBusinessLayers 提供，此处只消费四方法子集） */
  manager: RouteLayerManager
}

interface Emits {
  /** 查询完成（found 段列表 + 完整点链），页面据此渲染摘要 */
  (_e: 'query-result', _payload: { segments: RoutePathResult[]; pointCount: number }): void
  /** 清除全部选点与图层 */
  (_e: 'cleared'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const mapStore = useMapStore()
const { queryPath, searchPois, calculating } = useRouteApi()
const { updateRouteLayers, clearRouteLayers } = useRouteLayer()

const { cellPixel, css } = useGCS()
const { cell8px, cell16px } = css
const btnHeightCss = computed(() => `${cellPixel.value * 0.8}px`)
const labelFontSizeCss = computed(() => `${cellPixel.value * 0.175}px`)

/** 四槽状态：key 顺序即途径链顺序（from → waypoint-1 → waypoint-2 → to） */
const slots = ref<Record<RouteSlotKey, RoutePoint | null>>({
  from: null,
  'waypoint-1': null,
  'waypoint-2': null,
  to: null,
})

/** 当前拾取槽（null = 不在选点模式）：POI 弹层与地图选点共用 */
const activeSlot = ref<RouteSlotKey | null>(null)

const SLOT_LABELS: Record<RouteSlotKey, string> = {
  from: '起点',
  'waypoint-1': '途径点',
  'waypoint-2': '途径点',
  to: '终点',
}

/** 槽按钮文案：拾取中 → 引导；已选 → POI 名优先、否则坐标；未选 → +标签 */
function slotLabel(key: RouteSlotKey): string {
  if (activeSlot.value === key) return `${SLOT_LABELS[key]}：点地图或选 POI…`
  const p = slots.value[key]
  if (!p) return `+ ${SLOT_LABELS[key]}`
  return p.name ?? `${p.lng.toFixed(4)}, ${p.lat.toFixed(4)}`
}

/** 已选槽位计数（查询按钮可用性：至少起终点齐） */
const hasFromTo = computed(() => slots.value.from !== null && slots.value.to !== null)

// ---- POI 弹层 ----
const poiPanelOpen = ref(false)
const poiKeyword = ref('')
const poiList = ref<PoiSearchItemParsed[]>([])
const poiLoading = ref(false)

async function openPoiPanel(key: RouteSlotKey): Promise<void> {
  activeSlot.value = key
  poiPanelOpen.value = true
  await refreshPois()
}

async function refreshPois(): Promise<void> {
  poiLoading.value = true
  try {
    poiList.value = await searchPois(poiKeyword.value, 30)
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'POI 查询失败'
    showError(msg, { fallback: 'POI 查询失败，请稍后重试' })
    poiList.value = []
  } finally {
    poiLoading.value = false
  }
}

/** 点击 POI 项：填入激活槽 → 飞行定位 → 流转下一槽（起点选完即选终点，途径槽跳过） */
function pickPoi(poi: PoiSearchItemParsed): void {
  const key = activeSlot.value
  if (!key) return
  slots.value[key] = { lng: poi.lng, lat: poi.lat, name: poi.name }
  poiPanelOpen.value = false
  logger.debug('[RoutePanel] POI 选点:', key, poi.name, poi.lng, poi.lat)
  void mapStore.currentRenderer?.flyTo({ lng: poi.lng, lat: poi.lat })
  advanceSlot(key)
}

/** 选完一个槽后流转：起点/途径 → 终点；终点 → 结束（用户口径：选完起点就开始选终点） */
function advanceSlot(done: RouteSlotKey): void {
  if (done === 'to') {
    activeSlot.value = null
    return
  }
  activeSlot.value = 'to'
}

// ---- 地图选点（页面把渲染器 click 转交进来） ----

/** 地图点击选点：无激活槽时忽略；范围外提示「暂无数据」 */
async function handleMapPick(lng: number, lat: number): Promise<void> {
  const key = activeSlot.value
  if (!key || poiPanelOpen.value) return
  const ok = await isWithinThreeCities(lng, lat)
  if (!ok) {
    showWarning('该区域暂无数据，请选择钦州/北海/防城港市域内的位置')
    return
  }
  slots.value[key] = { lng, lat }
  logger.debug('[RoutePanel] 地图选点:', key, lng, lat)
  advanceSlot(key)
}

/** 定位图标点击：进入该槽的地图选点模式（关掉 POI 弹层避免遮挡地图） */
function startMapPick(key: RouteSlotKey): void {
  activeSlot.value = key
  poiPanelOpen.value = false
  showWarning(`请在地图上点击选择${SLOT_LABELS[key]}（限钦北防三市范围）`)
}

/** 重新激活某槽（点已选按钮 = 重选，可修改该槽） */
function activateSlot(key: RouteSlotKey): void {
  if (activeSlot.value === key) {
    activeSlot.value = null
    return
  }
  activeSlot.value = key
}

// ---- 查询（逐段拼接） ----

/** 非空槽按链序展开：from → 途径… → to */
function buildChain(): RoutePoint[] {
  return ROUTE_SLOT_KEYS.map((k) => slots.value[k]).filter((p): p is RoutePoint => p !== null)
}

async function handleQuery(): Promise<void> {
  if (!hasFromTo.value) {
    showWarning('请先选择起点与终点')
    return
  }
  if (calculating.value) {
    showWarning('查询正在进行中，请稍候')
    return
  }
  const chain = buildChain()
  const segments: RoutePathResult[] = []
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i]
    const b = chain[i + 1]
    try {
      const resp = await queryPath({
        fromLng: a.lng,
        fromLat: a.lat,
        toLng: b.lng,
        toLat: b.lat,
        mode: 'distance',
      })
      if (!resp.found) {
        const reasons: Record<string, string> = {
          origin_not_snapped: '未吸附到路网（离道路过远）',
          destination_not_snapped: '未吸附到路网（离道路过远）',
          unreachable: '两点间路网不连通',
        }
        showWarning(`第 ${i + 1} 段（${slotName(a)} → ${slotName(b)}）：${reasons[resp.reason] ?? '未找到可达路径'}`)
        break
      }
      segments.push(resp)
    } catch (error) {
      if (error instanceof RouteQueryCancelledError) return
      const msg = error instanceof Error ? error.message : '路径查询失败'
      showError(msg, { fallback: '路径查询失败，请稍后重试' })
      break
    }
  }
  // 已成功段也上图（多段中断时保留可达部分），槽点始终刷新
  updateRouteLayers(props.manager, segments, collectSlots())
  if (segments.length > 0) {
    emit('query-result', { segments, pointCount: chain.length })
  }
}

function slotName(p: RoutePoint): string {
  return p.name ?? `${p.lng.toFixed(3)}, ${p.lat.toFixed(3)}`
}

function collectSlots(): RouteSlot[] {
  return ROUTE_SLOT_KEYS.map((key) => ({ key, point: slots.value[key] }))
}

function handleClear(): void {
  slots.value = { from: null, 'waypoint-1': null, 'waypoint-2': null, to: null }
  activeSlot.value = null
  poiPanelOpen.value = false
  clearRouteLayers(props.manager)
  emit('cleared')
}

onUnmounted(() => {
  // 查询在途取消（useRouteApi 内部信号复位）；图层随页面卸载统一清
  clearRouteLayers(props.manager)
})

defineExpose({
  /** 页面渲染器 click 处理器转交入口（选点模式判断在面板内） */
  handleMapPick,
  /** 页面结果面板「清除全部」入口 */
  handleClear,
})
</script>

<template>
  <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
    <div class="route-panel">
      <div class="route-grid">
        <!-- 顶行：查询 POI（3.8 通栏） -->
        <button
          class="route-btn span-2 poi-open"
          :class="{ active: poiPanelOpen }"
          @click="openPoiPanel(activeSlot ?? 'from')"
        >
          查询 POI 点
        </button>

        <!-- 中部四槽：2×2（1.8 宽）；主体点击 = POI 选择，定位图标 = 地图选点 -->
        <button
          v-for="key in (['from', 'waypoint-1', 'waypoint-2', 'to'] as const)"
          :key="key"
          class="route-btn slot-btn"
          :class="{ active: activeSlot === key, filled: slots[key] !== null }"
          @click="activateSlot(key)"
        >
          <span class="slot-text">{{ slotLabel(key) }}</span>
          <span
            class="locate-icon"
            title="去地图上自己选点"
            @click.stop="startMapPick(key)"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path
                d="M8 1a5 5 0 0 1 5 5c0 3.4-5 9-5 9S3 9.4 3 6a5 5 0 0 1 5-5Z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
              />
              <circle cx="8" cy="6" r="1.8" fill="currentColor" />
            </svg>
          </span>
        </button>

        <!-- 底行：开始查询（3.8 通栏主按钮） -->
        <button
          class="route-btn span-2 primary"
          :disabled="!hasFromTo || calculating"
          @click="handleQuery"
        >
          {{ calculating ? '查询中…' : '开始查询' }}
        </button>
      </div>

      <!-- POI 弹层（面板内覆盖） -->
      <div v-if="poiPanelOpen" class="poi-pop">
        <div class="poi-head">
          <input
            v-model="poiKeyword"
            class="poi-input"
            placeholder="搜索 POI 名称…"
            @input="refreshPois"
          />
          <button class="poi-close" title="关闭" @click="poiPanelOpen = false">×</button>
        </div>
        <div class="poi-list">
          <div v-if="poiLoading" class="poi-hint">查询中…</div>
          <div v-else-if="poiList.length === 0" class="poi-hint">无匹配 POI</div>
          <button
            v-for="poi in poiList"
            :key="poi.id"
            class="poi-item"
            @click="pickPoi(poi)"
          >
            <span class="poi-name">{{ poi.name }}</span>
            <span class="poi-meta">{{ poi.district ?? poi.city }} · {{ poi.type }}</span>
          </button>
        </div>
      </div>
    </div>
  </GCSPanel>
</template>

<style scoped>
.route-panel {
  position: relative;
  width: 100%;
  height: 100%;
  padding: v-bind(cell8px);
  box-sizing: border-box;
}

.route-grid {
  display: grid;
  grid-template-columns: repeat(2, 1.8fr);
  grid-auto-rows: v-bind(btnHeightCss);
  gap: v-bind(cell16px);
  height: 100%;
  align-content: start;
}

.span-2 {
  grid-column: span 2;
}

.route-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  background: var(--GCS-bg-panel);
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-lg);
  color: var(--GCS-text-regular);
  font-size: v-bind(labelFontSizeCss);
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
}

.route-btn:hover {
  border-color: var(--GCS-color-primary);
  background: var(--GCS-bg-hover);
}

.route-btn.active {
  border-color: var(--GCS-color-primary);
  color: var(--GCS-color-primary);
}

.route-btn.filled {
  color: var(--GCS-text-primary);
}

.route-btn.primary {
  background: var(--GCS-color-primary);
  border-color: var(--GCS-color-primary);
  color: var(--GCS-text-inverse);
}

.route-btn.primary:hover:not(:disabled) {
  background: var(--GCS-color-primary-hover);
  border-color: var(--GCS-color-primary-hover);
}

.route-btn.primary:disabled {
  color: var(--GCS-text-disabled);
  cursor: not-allowed;
}

.slot-btn {
  justify-content: space-between;
  padding: 0 8px;
}

.slot-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-align: left;
}

.locate-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: var(--GCS-text-muted);
}

.locate-icon:hover {
  color: var(--GCS-color-primary);
  background: var(--GCS-bg-hover);
}

.poi-pop {
  position: absolute;
  inset: v-bind(cell8px);
  z-index: 2;
  display: flex;
  flex-direction: column;
  background: var(--GCS-bg-panel);
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-lg);
  overflow: hidden;
}

.poi-head {
  display: flex;
  gap: 4px;
  padding: 6px;
}

.poi-input {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--GCS-border-default);
  border-radius: 4px;
  background: var(--GCS-bg-elevated);
  color: var(--GCS-text-primary);
  font-size: 12px;
  outline: none;
}

.poi-input:focus {
  border-color: var(--GCS-color-primary);
}

.poi-close {
  width: 24px;
  border: none;
  background: transparent;
  color: var(--GCS-text-muted);
  font-size: 14px;
  cursor: pointer;
}

.poi-close:hover {
  color: var(--GCS-color-primary);
}

.poi-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 6px 6px;
}

.poi-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--GCS-text-primary);
  text-align: left;
  cursor: pointer;
}

.poi-item:hover {
  background: var(--GCS-bg-hover);
}

.poi-name {
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.poi-meta {
  font-size: 10px;
  color: var(--GCS-text-muted);
}

.poi-hint {
  padding: 12px 8px;
  color: var(--GCS-text-muted);
  font-size: 12px;
  text-align: center;
}
</style>
