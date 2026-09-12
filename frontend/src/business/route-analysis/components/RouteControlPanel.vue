<script setup lang="ts">
/**
 * 航线分析控制面板（图层控制面板上方 4×4 槽位）：
 * 顶行「POI 搜索框」（3.8 宽通栏，常驻）——输入即搜，结果在搜索框下方下拉展开
 *（不覆盖搜索框本身；初始即载入一批兜底 POI 填充列表），点选填入激活槽并飞行定位；
 * 中部四个 1.8 宽槽位按钮（起点/途径1/途径2/终点，途径可空）——
 *   按钮主体 = 聚焦 POI 搜索（激活该槽）；右侧定位图标 = 地图选点模式（悬浮提示），
 *   仅限钦北防三市；
 * 底行「最短/最快」口径切换 + 「开始查询」主按钮 → 按起点→途径→终点链逐段查询（后端 /route/path 单段），
 *   段折线全部上图，总里程/时长 emit 给页面结果面板。
 * 按钮规格对齐 SiteAnalysisControlPanel：2×1.8fr grid、0.8cell 行高、token 全走 --GCS-*。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { GCSPanel } from '@/core'
import { logger, showError, showWarning, useGCS } from '@/shared'
import { useMapStore } from '@/stores'
import type { RoutePathParams, RoutePathResult } from '@/types'
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
const { queryPath, searchPois, calculating, cancel } = useRouteApi()
const { updateRouteLayers, clearRouteLayers } = useRouteLayer()

/**
 * 寻路口径（2026-09-13 v2 路网上线时补的开关）。
 *
 * 此前前端**硬编码 mode:'distance'**，后端的 time 口径（按等级限速 + 道路偏好寻路、
 * 报真实时长）用户根本点不到。两档语义：
 *   · distance（最短）——纯几何最短，不加任何道路偏好；
 *   · time（最快）     ——按等级限速算时间（高速 110/国道 80/支路 40/居住区 25 km/h），
 *                        并对低等级道与受限通行道加权（避村道、避免穿小区抄近路）。
 * 权重口径与后端 route.repository 的 MODE_WEIGHT 一一对应，改这里要同步那边。
 */
type RouteModeKey = NonNullable<RoutePathParams['mode']>
const mode = ref<RouteModeKey>('distance')

/** 口径选项（渲染顺序即按钮顺序） */
const MODE_OPTIONS: ReadonlyArray<{ key: RouteModeKey; label: string; title: string }> = [
  { key: 'distance', label: '最短', title: '最短距离：几何最短路，不加道路偏好' },
  { key: 'time', label: '最快', title: '最快时间：按等级限速与道路偏好寻路，报真实时长' },
]

/** 是否已有查询结果：切口径时据此决定要不要立即重跑 */
const hasResult = ref(false)

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

// ---- 搜索（多源点集：港口/淹没设施点/小区/POI） ----

/** 来源点集 → 中文标签（与后端 MULTI_SOURCE_SEARCH_SQL 的 source 值一一对应） */
const SOURCE_LABELS: Record<string, string> = {
  port: '港口',
  facility: '设施点',
  xiaoqu: '小区',
  poi: 'POI',
}

const poiKeyword = ref('')
const poiList = ref<PoiSearchItemParsed[]>([])
const poiLoading = ref(false)
/** 查询失败态（下拉内提示，不弹全局 toast——PG 未起等环境态不该每次进页弹 3 个错误） */
const poiError = ref(false)
const poiDropOpen = ref(false)
/** 面板根节点：外部点击（含地图）关闭下拉的判定边界 */
const panelRoot = ref<HTMLElement | null>(null)
/**
 * 抓取的暂存点：搜索结果 / 地图点击先落到这里，再由用户点某个槽位注入。
 * 2026-09-12 用户口径：搜索框只负责"抓点"，槽位负责"归位"——否则必须先激活槽位才能搜索，
 * 搜索框形同虚设。
 */
const pendingPoint = ref<{ lng: number; lat: number; name?: string; source?: string } | null>(null)
/** 暂存点显示文案：有名字用名字，只有坐标用坐标 */
const pendingLabel = computed(() => {
  const p = pendingPoint.value
  if (!p) return ''
  return p.name ?? `${p.lng.toFixed(4)}, ${p.lat.toFixed(4)}`
})
/** 暂存点来源标签（港口/设施点/小区/POI；地图抓取无来源则不显示） */
const pendingSource = computed(() =>
  pendingPoint.value?.source ? (SOURCE_LABELS[pendingPoint.value.source] ?? '') : ''
)

/**
 * 下拉项副标题：`来源 · 补充信息`。
 * 港口/设施点没有 city/district（服务端归一为空串，`??` 会停在空串上），故用 `||` 逐级回落
 * 到 type；两者相同或都为空时只显示来源，避免出现 "港口 ·" 这类空尾巴。
 */
function metaLabel(poi: PoiSearchItemParsed): string {
  const source = SOURCE_LABELS[poi.source] ?? poi.type
  const extra = poi.district || poi.city || poi.type || ''
  return extra && extra !== source ? `${source} · ${extra}` : source
}
let poiDebounceTimer: ReturnType<typeof setTimeout> | null = null
/** POI 请求取消源：新请求抢占旧请求、卸载时终止在途（审查 M-6） */
let poiAbort: AbortController | null = null

async function refreshPois(): Promise<void> {
  poiAbort?.abort()
  const ac = new AbortController()
  poiAbort = ac
  poiLoading.value = true
  poiError.value = false
  try {
    poiList.value = await searchPois(poiKeyword.value, 50, ac.signal)
  } catch (error) {
    // 被新请求抢占或卸载取消：非错误，不动 UI 态（避免下拉误显「查询失败」）
    if (ac.signal.aborted) return
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

/** 激活某槽并展开下拉（无暂存点时的槽按钮入口） */
function focusSlotWithPoi(key: RouteSlotKey): void {
  activeSlot.value = key
  poiDropOpen.value = true
  if (poiList.value.length === 0) void refreshPois()
}

/**
 * 落点：把点写入指定槽（唯一注入入口）。
 *
 * 注入后清空暂存与激活态，**不再自动流转到下一槽**（2026-09-12 交互重构）。原「起点选完
 * 自动流转到终点」有两个副作用：①想选途径点时被迫先接受终点态；②下拉此时已关，再点「终点」
 * 会被判成"取消激活"（第一下没反应）——线上实测复现。
 */
function fillSlot(key: RouteSlotKey, point: RoutePoint): void {
  slots.value[key] = point
  pendingPoint.value = null
  activeSlot.value = null
  poiDropOpen.value = false
  void mapStore.currentRenderer?.flyTo({ lng: point.lng, lat: point.lat })
}

/**
 * 点击搜索结果：
 *   · 有激活槽（先前点过槽位/定位图标）→ 直接落入该槽（快路径，兼容旧习惯）；
 *   · 无激活槽 → **抓取暂存**，等用户点某个槽位注入（"选定地点 → 点起点框 = 设为起点"）。
 */
function pickPoi(poi: PoiSearchItemParsed): void {
  const key = activeSlot.value
  poiDropOpen.value = false
  if (key) {
    logger.debug('[RoutePanel] 搜索结果注入激活槽:', key, poi.name, poi.lng, poi.lat)
    fillSlot(key, { lng: poi.lng, lat: poi.lat, name: poi.name })
    return
  }
  pendingPoint.value = { lng: poi.lng, lat: poi.lat, name: poi.name, source: poi.source }
  void mapStore.currentRenderer?.flyTo({ lng: poi.lng, lat: poi.lat })
  logger.debug('[RoutePanel] 抓取点（待注入）:', poi.name, poi.lng, poi.lat)
}

// ---- 地图选点（页面把渲染器 click 转交进来） ----

/**
 * 地图点击：**永不静默丢弃**。
 *
 * 原实现 `if (!key || poiDropOpen.value) return` 在下拉打开时把点击整个吞掉、且不关下拉——
 * 而下拉又覆盖着槽位区（定位图标点不到），用户表现为"点地图没反应 + 查询按钮一直不可用"，
 * 即 2026-09-12 线上反馈的「自选点查询不通」（浏览器实测复现）。
 * 现口径：先收起下拉 → 范围校验 → 有激活槽则落入该槽，否则抓取为暂存点等用户点槽注入。
 */
async function handleMapPick(lng: number, lat: number): Promise<void> {
  poiDropOpen.value = false
  const ok = await isWithinThreeCities(lng, lat)
  if (!ok) {
    showWarning('该区域暂无数据，请选择钦州/北海/防城港市域内的位置')
    return
  }
  const key = activeSlot.value
  if (key) {
    logger.debug('[RoutePanel] 地图选点:', key, lng, lat)
    fillSlot(key, { lng, lat })
    return
  }
  pendingPoint.value = { lng, lat }
  logger.debug('[RoutePanel] 地图抓取点（待注入）:', lng, lat)
}

/** 定位图标点击：进入该槽的地图选点模式（收起下拉避免遮挡地图） */
function startMapPick(key: RouteSlotKey): void {
  activeSlot.value = key
  poiDropOpen.value = false
  showWarning(`请在地图上点击选择${SLOT_LABELS[key]}（限钦北防三市范围）`)
}

/**
 * 槽按钮主体点击（统一入口）：
 *   ① 有暂存点 → 注入该槽（"抓取 → 注入"主路径）；
 *   ② 该槽已激活且下拉开着 → 收起（再点一次收起，符合直觉）；
 *   ③ 其余情形 → 展开下拉。**不做"取消激活"**：原实现在"已激活但下拉已关"（选点后遗留态）
 *      时会把它当成取消，导致第一下点击无任何反应。
 */
function activateSlot(key: RouteSlotKey): void {
  const pending = pendingPoint.value
  if (pending) {
    logger.debug('[RoutePanel] 暂存点注入槽:', key, pending.name ?? pending.lng)
    fillSlot(key, { lng: pending.lng, lat: pending.lat, name: pending.name })
    return
  }
  if (activeSlot.value === key && poiDropOpen.value) {
    activeSlot.value = null
    poiDropOpen.value = false
    return
  }
  focusSlotWithPoi(key)
}

/** 取消抓取（暂存态搜索框右侧 ✕） */
function clearPending(): void {
  pendingPoint.value = null
}

/**
 * 外部点击（面板之外，含地图画布）→ 收起下拉。
 * 原实现只能靠"选中某一项"关闭下拉，而下拉覆盖槽位区 → 定位图标不可达，形成交互死路。
 */
function onDocumentMouseDown(event: MouseEvent): void {
  if (!poiDropOpen.value) return
  if (panelRoot.value?.contains(event.target as Node)) return
  poiDropOpen.value = false
}

/**
 * 切换口径：已出结果时立即重跑（否则用户切了口径看不出变化，以为开关是摆设）；
 * 未出结果时只记状态，等用户点「开始查询」。
 */
function setMode(next: RouteModeKey): void {
  if (mode.value === next) return
  mode.value = next
  logger.debug('[RoutePanel] 切换寻路口径:', next)
  if (hasResult.value) void handleQuery()
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
        mode: mode.value,
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
  hasResult.value = segments.length > 0
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
  pendingPoint.value = null
  hasResult.value = false
  clearRouteLayers(props.manager)
  emit('cleared')
}

// 初始载入兜底列表（未输入关键词 → 多源点集优先级前 50 条）+ 外部点击收起下拉
onMounted(() => {
  void refreshPois()
  // 捕获阶段注册：无论点击落在哪个子元素上都能先判定是否"面板之外"
  document.addEventListener('mousedown', onDocumentMouseDown, true)
})

onUnmounted(() => {
  if (poiDebounceTimer) clearTimeout(poiDebounceTimer)
  // 取消在途路径查询与搜索请求：迟到响应会把路线图层写回全局共享 BLM、
  // 泄漏到其它页面（审查 M-5/M-6；cancel 由 useLatestRequest abort 在途信号）
  cancel()
  poiAbort?.abort()
  document.removeEventListener('mousedown', onDocumentMouseDown, true)
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
    <div ref="panelRoot" class="route-panel">
      <div class="route-grid">
        <!-- 顶行（3.8 通栏）：抓取态显示暂存点，否则显示搜索框 -->
        <div v-if="pendingPoint" class="pending-chip span-2">
          <span class="pending-text" :title="pendingLabel">
            <span v-if="pendingSource" class="pending-src">{{ pendingSource }}</span>
            {{ pendingLabel }}
            <span class="pending-tip">点下方槽位填入</span>
          </span>
          <span class="pending-clear" title="取消抓取，回到搜索" @click="clearPending">✕</span>
        </div>
        <input
          v-else
          v-model="poiKeyword"
          class="poi-search span-2"
          :class="{ focused: poiDropOpen }"
          type="text"
          placeholder="搜索港口/设施/小区/POI（名称过滤）…"
          @focus="poiDropOpen = true"
          @input="onPoiInput"
        />

        <!-- 中部四槽：2×2（1.8 宽）；主体点击 = 抓点注入 / 展开搜索，定位图标 = 地图选点 -->
        <button
          v-for="key in ROUTE_SLOT_KEYS"
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

        <!-- 底行：口径切换（最短/最快，左）+ 开始查询（右）——同高同规格，不改变面板行数 -->
        <div class="mode-seg" role="group" aria-label="寻路口径">
          <button
            v-for="opt in MODE_OPTIONS"
            :key="opt.key"
            class="mode-btn"
            :class="{ on: mode === opt.key }"
            :title="opt.title"
            @click="setMode(opt.key)"
          >
            {{ opt.label }}
          </button>
        </div>
        <button
          class="route-btn primary"
          :disabled="!hasFromTo || calculating"
          @click="handleQuery"
        >
          {{ calculating ? '查询中…' : '开始查询' }}
        </button>
      </div>

      <!-- 搜索结果下拉：锚定搜索框正下方展开；来源标签 = 港口/设施点/小区/POI -->
      <div v-if="poiDropOpen" class="poi-drop">
        <div v-if="poiLoading" class="poi-hint">查询中…</div>
        <div v-else-if="poiError" class="poi-hint">数据服务暂不可用（数据服务未就绪）</div>
        <div v-else-if="poiList.length === 0" class="poi-hint">无匹配结果</div>
        <button
          v-for="poi in poiList"
          :key="poi.id"
          class="poi-item"
          @mousedown.prevent="pickPoi(poi)"
        >
          <span class="poi-name">{{ poi.name }}</span>
          <span class="poi-meta">{{ metaLabel(poi) }}</span>
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

/* 口径切换（最短/最快）：两段式控件，与查询按钮同高同规格 */
.mode-seg {
  display: flex;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--GCS-bg-panel);
  border: 1px solid var(--GCS-border-default);
  border-radius: var(--GCS-radius-lg);
}

.mode-btn {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--GCS-text-regular);
  font-size: v-bind(labelFontSizeCss);
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}

.mode-btn + .mode-btn {
  border-left: 1px solid var(--GCS-border-default);
}

.mode-btn:hover {
  background: var(--GCS-bg-hover);
}

.mode-btn.on {
  background: var(--GCS-color-primary);
  color: var(--GCS-text-inverse);
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

/* 抓取态（暂存点）占位：与搜索框同规格，替换顶行不改变版面高度 */
.pending-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid var(--GCS-color-primary);
  border-radius: var(--GCS-radius-lg);
  background: var(--GCS-bg-hover);
  overflow: hidden;
}

.pending-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--GCS-text-primary);
  font-size: v-bind(labelFontSizeCss);
}

.pending-src {
  display: inline-block;
  margin-right: 4px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--GCS-color-primary);
  color: var(--GCS-text-inverse);
  font-size: calc(v-bind(labelFontSizeCss) * 0.85);
}

.pending-tip {
  margin-left: 4px;
  color: var(--GCS-color-primary);
}

.pending-clear {
  flex-shrink: 0;
  padding: 0 4px;
  color: var(--GCS-text-muted);
  cursor: pointer;
}

.pending-clear:hover {
  color: var(--GCS-color-primary);
}

/* 搜索结果下拉：锚定搜索框正下方（top=输入框高+panel padding），宽同内容区，
   不遮搜索框；覆盖中部槽区属预期（点选/外部点击后收起露出） */
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
