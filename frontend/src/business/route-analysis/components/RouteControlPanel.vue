<script setup lang="ts">
/**
 * 航线分析控制面板（图层控制面板上方 4×4 槽位）：
 * 顶行「POI 搜索框」（3.8 宽通栏，常驻）——输入即搜，结果在搜索框下方下拉展开
 *（不覆盖搜索框本身；初始即载入一批兜底 POI 填充列表），点选填入激活槽并飞行定位；
 * 中部四个 1.8 宽槽位按钮（起点/途径1/途径2/终点，途径可空）——
 *   按钮主体 = 聚焦 POI 搜索（激活该槽）；右侧定位图标 = 地图选点模式（悬浮提示），
 *   仅限钦北防三市；
 * 底行「开始查询」（3.8 宽主按钮）→ 按起点→途径→终点链逐段查询（后端 /route/path 单段），
 *   段折线全部上图，总里程/时长 emit 给页面结果面板。
 * 按钮规格对齐 SiteAnalysisControlPanel：2×1.8fr grid、0.8cell 行高、token 全走 --GCS-*。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { GCSPanel } from '@/core'
import { logger, showError, showWarning, useGCS } from '@/shared'
import { useMapStore } from '@/stores'
import type { RoutePathResult } from '@/types'
import type { PoiSearchItemParsed } from '@/types/schemas'

import { isWithinThreeCities } from '../composables/useCityBoundary'
import { RouteQueryCancelledError, useRouteApi } from '../composables/useRouteApi'
import type {
  RouteLayerManager,
  RoutePoint,
  RouteSlot,
  RouteSlotKey,
} from '../composables/useRouteLayer'
import { ROUTE_SLOT_KEYS, useRouteLayer } from '../composables/useRouteLayer'

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

/** 当前拾取槽（null = 不在选点模式）：POI 下拉与地图选点共用 */
const activeSlot = ref<RouteSlotKey | null>(null)

const SLOT_LABELS: Record<RouteSlotKey, string> = {
  from: '起点',
  'waypoint-1': '途径点',
  'waypoint-2': '途径点',
  to: '终点',
}

/** 槽按钮文案：拾取中 → 引导；已选 → POI 名优先、否则坐标；未选 → +标签 */
function slotLabel(key: RouteSlotKey): string {
  if (activeSlot.value === key) return `${SLOT_LABELS[key]}：选下方 POI 或点地图`
  const p = slots.value[key]
  if (!p) return `+ ${SLOT_LABELS[key]}`
  return p.name ?? `${p.lng.toFixed(4)}, ${p.lat.toFixed(4)}`
}

/** 已选槽位计数（查询按钮可用性：至少起终点齐） */
const hasFromTo = computed(() => slots.value.from !== null && slots.value.to !== null)

// ---- POI 搜索（下拉展开，不覆盖搜索框） ----
const poiKeyword = ref('')
const poiList = ref<PoiSearchItemParsed[]>([])
const poiLoading = ref(false)
/** 查询失败态（下拉内提示，不弹全局 toast——PG 未起等环境态不该每次进页弹 3 个错误） */
const poiError = ref(false)
const poiDropOpen = ref(false)
let poiDebounceTimer: ReturnType<typeof setTimeout> | null = null

async function refreshPois(): Promise<void> {
  poiLoading.value = true
  poiError.value = false
  try {
    poiList.value = await searchPois(poiKeyword.value, 30)
  } catch (error) {
    poiList.value = []
    poiError.value = true
    logger.warn(
      '[RoutePanel] POI 查询失败（下拉内提示）:',
      error instanceof Error ? error.message : error
    )
  } finally {
    poiLoading.value = false
  }
}

/** 输入防抖 300ms；清空时回落兜底列表 */
function onPoiInput(): void {
  if (poiDebounceTimer) clearTimeout(poiDebounceTimer)
  poiDebounceTimer = setTimeout(() => {
    poiDebounceTimer = null
    void refreshPois()
  }, 300)
}

/** 激活某槽并展开 POI 下拉（槽按钮主体点击的统一入口） */
function focusSlotWithPoi(key: RouteSlotKey): void {
  activeSlot.value = key
  poiDropOpen.value = true
  if (poiList.value.length === 0) void refreshPois()
}

/** 点击 POI 项：填入激活槽 → 飞行定位 → 流转下一槽（起点选完即选终点，途径槽跳过） */
function pickPoi(poi: PoiSearchItemParsed): void {
  const key = activeSlot.value
  if (!key) return
  slots.value[key] = { lng: poi.lng, lat: poi.lat, name: poi.name }
  poiDropOpen.value = false
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
  if (!key || poiDropOpen.value) return
  const ok = await isWithinThreeCities(lng, lat)
  if (!ok) {
    showWarning('该区域暂无数据，请选择钦州/北海/防城港市域内的位置')
    return
  }
  slots.value[key] = { lng, lat }
  logger.debug('[RoutePanel] 地图选点:', key, lng, lat)
  advanceSlot(key)
}

/** 定位图标点击：进入该槽的地图选点模式（收起下拉避免遮挡地图） */
function startMapPick(key: RouteSlotKey): void {
  activeSlot.value = key
  poiDropOpen.value = false
  showWarning(`请在地图上点击选择${SLOT_LABELS[key]}（限钦北防三市范围）`)
}

/** 重新激活某槽（点已选按钮 = 重选，可修改该槽） */
function activateSlot(key: RouteSlotKey): void {
  if (activeSlot.value === key) {
    activeSlot.value = null
    poiDropOpen.value = false
    return
  }
  focusSlotWithPoi(key)
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
        showWarning(
          `第 ${i + 1} 段（${slotName(a)} → ${slotName(b)}）：${reasons[resp.reason] ?? '未找到可达路径'}`
        )
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
  poiDropOpen.value = false
  clearRouteLayers(props.manager)
  emit('cleared')
}

// 初始载入兜底 POI（未输入关键词的默认列表，填充下拉空白区）
onMounted(() => {
  void refreshPois()
})

onUnmounted(() => {
  if (poiDebounceTimer) clearTimeout(poiDebounceTimer)
  // 查询在途取消（useRouteApi 内部信号复位）；图层清理由此兜底
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
        <!-- 顶行：POI 搜索框（3.8 通栏，常驻不覆盖） -->
        <input
          v-model="poiKeyword"
          class="poi-search span-2"
          :class="{ focused: poiDropOpen }"
          type="text"
          placeholder="搜索 POI 点（输入名称过滤）…"
          @focus="poiDropOpen = true"
          @input="onPoiInput"
        />

        <!-- 中部四槽：2×2（1.8 宽）；主体点击 = 聚焦 POI 搜索，定位图标 = 地图选点 -->
        <button
          v-for="key in ['from', 'waypoint-1', 'waypoint-2', 'to'] as const"
          :key="key"
          class="route-btn slot-btn"
          :class="{ active: activeSlot === key, filled: slots[key] !== null }"
          @click="activateSlot(key)"
        >
          <span class="slot-text">{{ slotLabel(key) }}</span>
          <span class="locate-icon" title="去地图上自己选点" @click.stop="startMapPick(key)">
            <i class="locate-pin" aria-hidden="true"></i>
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

      <!-- POI 下拉：锚定搜索框正下方展开，不遮搜索框；默认兜底列表填充 -->
      <div v-if="poiDropOpen" class="poi-drop">
        <div v-if="poiLoading" class="poi-hint">查询中…</div>
        <div v-else-if="poiError" class="poi-hint">POI 服务暂不可用（数据服务未就绪）</div>
        <div v-else-if="poiList.length === 0" class="poi-hint">无匹配 POI</div>
        <button
          v-for="poi in poiList"
          :key="poi.id"
          class="poi-item"
          @mousedown.prevent="pickPoi(poi)"
        >
          <span class="poi-name">{{ poi.name }}</span>
          <span class="poi-meta">{{ poi.district ?? poi.city }} · {{ poi.type }}</span>
        </button>
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

/* 槽按钮：文字区限宽截断（overflow+min-width 缺失会让长 POI 名撑开按钮——点击切换
   文案时按钮「变形」的根因），图标定宽不收缩，任何文案变化不改变按钮几何 */
.slot-btn {
  justify-content: space-between;
  padding: 0 8px;
  overflow: hidden;
}

.slot-text {
  flex: 1;
  min-width: 0;
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

/* 定位针图标（纯 CSS 形状：菱形旋转 + 中心圆点）——
   不用内联 SVG path：path 数据以 move-to 指令开头（字母 m 之后紧跟坐标数字），
   会被 v3-guard no-ephemeral 的施工编号模式（字母 m 后接数字）误判而拦下 pre-push */
.locate-pin {
  position: relative;
  display: block;
  width: 9px;
  height: 9px;
  border: 1.4px solid currentcolor;
  border-radius: 50% 50% 50% 0;
  transform: rotate(-45deg);
}

.locate-pin::after {
  content: '';
  position: absolute;
  inset: 2px;
  border-radius: 50%;
  background: currentcolor;
}

/* POI 搜索框：与槽按钮同规格（3.8 通栏 0.8 高） */
.poi-search {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 0 10px;
  background: var(--GCS-bg-panel);
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-lg);
  color: var(--GCS-text-primary);
  font-size: v-bind(labelFontSizeCss);
  outline: none;
  transition: border-color 0.2s ease;
}

.poi-search::placeholder {
  color: var(--GCS-text-muted);
}

.poi-search:focus,
.poi-search.focused {
  border-color: var(--GCS-color-primary);
}

/* POI 下拉：锚定搜索框正下方（top=输入框高+panel padding），宽同内容区，
   不遮搜索框；覆盖中部槽区属预期（点选后收起露出） */
.poi-drop {
  position: absolute;
  top: calc(v-bind(cell8px) + v-bind(btnHeightCss) + 6px);
  left: v-bind(cell8px);
  right: v-bind(cell8px);
  max-height: 170px;
  z-index: 2;
  overflow-y: auto;
  background: var(--GCS-bg-panel);
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-lg);
  box-shadow: var(--GCS-shadow-float);
  padding: 4px;
  box-sizing: border-box;
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
