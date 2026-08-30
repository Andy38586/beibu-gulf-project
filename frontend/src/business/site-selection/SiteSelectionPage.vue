<script setup lang="ts">
/**
 * 选址分析业务页：左上雷达图（第一名/选中小区）、左下小区名单、
 * 右上设施因子面板、右下图层控制（各 4×4）。
 * 跳转个人中心时保存状态、返回恢复，跳其他路由清除。
 */

import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

import {
  AppLayout,
  GCSPanel,
  LayerControlPanel,
  MAP_CONFIG,
  useBusinessLayers,
  useMapControls,
} from '@/core'
import {
  FACILITY_COLORS,
  FACILITY_COLORS_MAP,
  logger,
  PaginatedListPanel,
  showError,
  showModal,
  showWarning,
} from '@/shared'
import { useMapStore, useSiteSelectionStore } from '@/stores'
import type { GeoPoint } from '@/types'
import type { AnalysisResult, FacilityPoint, ScoredXiaoqu } from '@/types/analysis'
import { RadarChart, SNAPSHOT_SELECTED_TYPES, SNAPSHOT_XIAOQU } from '@/visualization'

import SiteAnalysisControlPanel from './components/SiteAnalysisControlPanel.vue'
import {
  buildFacilityPoiLayer,
  computeHitPoiIds,
  computeParticipatingPoiIds,
  effectiveRadiusKm,
  NEARBY_FACILITY_LAYER_ID,
  useAnalysisLayer,
} from './composables/useAnalysisLayer'
import { CITY_CENTER_NAMES, useCityScope } from './composables/useCityScope'

const {
  flyTo,
  startBreathing,
  stopBreathing,
  startFacilityBreathing,
  stopFacilityBreathing,
  zoomToCity,
  mapInstance,
} = useMapControls()

// 当前视图所在城市：由相机反推。城市按钮 flyTo 与手动拖动地图走同一条判定，
// 不再另设"当前城市"全局状态（避免双写漂移）
const { currentCity } = useCityScope(() => mapInstance.value?.getRenderer?.() ?? null)
const stateStore = useSiteSelectionStore()
const mapStore = useMapStore()
const { manager: businessLayerManager } = useBusinessLayers()
// useAnalysisLayer 的 createUpdateHandler 接受含 register/updateData/has 的 manager 窄接口，
// 与页面注入的 BusinessLayerManagerLike 结构兼容，无需类型断言
const { createUpdateHandler } = useAnalysisLayer()
// 图层更新回调由页面直连 businessLayerManager（store 已不含分析回调机制）
const updateAnalysisHandler = createUpdateHandler(businessLayerManager)

// 保存定时器 id，卸载时清理悬挂定时器
let tryZoomTimer: ReturnType<typeof setTimeout> | null = null

/** 分析结果（816-专项2 4-3：store 唯一来源，storeToRefs 透传——页面与 AppLayout 全局雷达同源，
 *  原本地 ref 双持 + handleResult/restoreState 双写维持一致的反模式已移除） */
const { matchedXiaoqu, selectedTypes, facilityPoi, calculating } = storeToRefs(stateStore)

/** 雷达图当前选中小区（页内临时态，仅本地） */
const selectedXiaoqu = ref<ScoredXiaoqu | null>(null)

/** 雷达轴名点亮的类型集合（多类型叠加，一类一类开始呼吸；随显隐指标联动启停，见 syncFacilityBreathing） */
const activeBreathTypes = ref<Set<string>>(new Set())

/** 命中设施集合（按类型）：点小区候选后计算，驱动 per-point 透明度（激活 100% / 其余低暗） */
const hitByType = ref<Record<string, Set<string>> | null>(null)

/**
 * 参与选址的设施点（按类型，渲染集合）：被「任一匹配小区」覆盖半径内的点才算参与——
 * 没参与小区选址的点不上图（全量千级 → 参与数百级，视觉聚焦与性能双赢）。
 * importance 取面板当前值，与后端 buffer 同口径
 */
const participatingPoi = ref<Record<string, FacilityPoint[]>>({})

/** 面板 importance 快照（getSettings 深拷贝；无面板/无值时按默认档 3） */
function currentImportance(): Record<string, number> {
  const settings = (factorPanelRef.value?.getSettings?.() ?? {}) as Record<
    string,
    { importance?: number } | undefined
  >
  const out: Record<string, number> = {}
  for (const t of selectedTypes.value) {
    out[t] = settings[t]?.importance ?? 3
  }
  return out
}

/** 计算（重算）参与集合：新分析结果到达或恢复快照时调用 */
function computeParticipating(): void {
  const importanceByType = currentImportance()
  const out: Record<string, FacilityPoint[]> = {}
  for (const t of selectedTypes.value) {
    const pois = facilityPoi.value[t]
    if (!pois || pois.length === 0) continue
    const ids = computeParticipatingPoiIds(
      matchedXiaoqu.value,
      pois,
      effectiveRadiusKm(t, importanceByType[t])
    )
    out[t] = pois.filter((p) => p.id && ids.has(p.id))
  }
  participatingPoi.value = out
}

/** 附近设施图层显隐指标（图层控制面板 → BLM → mapStore.catalog 镜像，单一数据源）。
 *  registry 是权威，引擎切换时 catalog 业务条目短暂清空——缺省按可见处理，避免误停呼吸 */
const isFacilityLayerVisible = computed(
  () => mapStore.layerCatalog.find((e) => e.key === NEARBY_FACILITY_LAYER_ID)?.visible ?? true
)

/** 因子面板引用（用于获取/恢复状态） */
const factorPanelRef = ref<InstanceType<typeof SiteAnalysisControlPanel> | null>(null)

/** 处理分析错误（来自因子面板的 calcError） */
function handleAnalysisError(message: string): void {
  showError(message, { fallback: '选址分析失败，请调整筛选条件后重试' })
}

/** 8-1：无重叠区域 = 合法业务空结果（02 §4.1），提示用户调整条件而非报错 */
function handleAnalysisEmpty(reason: string): void {
  showWarning(reason)
}

/** 跨城视野下点分析：三城 POI 各自独立，跨城无法给出有意义的单城选址结果 */
function handleCrossCity(): void {
  showModal({
    message: '暂时只支持对一个城市进行选址分析。请将地图放大到钦州、北海或防城港的市区范围后重试。',
    mode: 'confirm',
    confirmText: '知道了',
  })
}

/** 限制显示前8个小区 */
const displayXiaoqu = computed<ScoredXiaoqu[]>(() => matchedXiaoqu.value.slice(0, 8))

/** 第一名小区（雷达图默认显示） */
const topXiaoqu = computed<ScoredXiaoqu | null>(() => matchedXiaoqu.value[0] || null)

/** 当前显示的小区（优先选中的，其次第一名；均无时回退默认快照，雷达图不空态） */
const displayXiaoquForRadar = computed<ScoredXiaoqu | null>(
  () => selectedXiaoqu.value || topXiaoqu.value || SNAPSHOT_XIAOQU
)

/** 雷达图指标：未分析时用快照的 6 类设施 */
const radarSelectedTypes = computed<string[]>(() =>
  selectedTypes.value.length > 0 ? selectedTypes.value : SNAPSHOT_SELECTED_TYPES
)

/** 处理分析结果 */
function handleResult(result: Partial<AnalysisResult>): void {
  logger.debug('[SiteSelection] 收到分析结果:', result)

  // 图层更新直调 updateAnalysisHandler；分析结果恢复走 useSiteSelectionStore 内存快照
  updateAnalysisHandler(result).catch(() => {})
  // 816-专项2 4-3：store 单一来源——setResult 同时驱动页面与 AppLayout 全局雷达（删本地双写）
  stateStore.setResult({
    matchedXiaoqu: result.matchedXiaoqu || [],
    selectedTypes: result.selectedTypes || [],
    facilityPoi: result.facilityPoi || {},
  })
  selectedXiaoqu.value = null
  // 新结果到来：命中集合与呼吸全部重置；参与集合按新匹配小区重算（渲染集合随之收缩）
  hitByType.value = null
  activeBreathTypes.value = new Set()
  stopBreathing()
  stopFacilityBreathing()
  computeParticipating()
  syncFacilityPoiLayer()
  if (matchedXiaoqu.value.length > 0) {
    flyToAnalyzedCity()
  }
}

/**
 * 同步附近设施图层（只渲染参与选址的点）：
 * 图层控制面板一个「附近设施」开关管总显隐（BLM 注册自动进 mapStore.layerCatalog），
 * 命中高亮经 updateData 整体重建（per-point opacity），点色/透明度都走 per-point 字段
 */
function syncFacilityPoiLayer(): void {
  const desc = buildFacilityPoiLayer(participatingPoi.value, selectedTypes.value, hitByType.value)
  const exists = businessLayerManager.has(desc.id)
  if (desc.data.length === 0) {
    if (exists) businessLayerManager.remove(desc.id)
    return
  }
  if (exists) {
    businessLayerManager.updateData(desc.id, { data: desc.data, options: desc.options })
  } else {
    businessLayerManager.register(desc.id, {
      label: desc.label,
      layerType: desc.layerType,
      data: desc.data,
      options: desc.options,
      visible: true,
    })
  }
}

/**
 * 设施呼吸启停收口（缩放式动效，每点按类型色）：呼吸只由雷达驱动——
 * 点亮集合里每个类型各自参战，点可携带 per-point color 混合呼吸；
 * 选中小区时呼吸收窄到该小区命中的点（第二层筛选），未选则各类型全部参与点
 */
function syncFacilityBreathing(): void {
  stopFacilityBreathing()
  if (!isFacilityLayerVisible.value || activeBreathTypes.value.size === 0) return
  const mixed: Array<GeoPoint & { color?: string }> = []
  for (const type of activeBreathTypes.value) {
    const pool = participatingPoi.value[type]
    if (!pool || pool.length === 0) continue
    // 选中小区 → 该小区命中的点（第二层）；未选 → 该类型全部参与点（第一层）
    const hits = selectedXiaoqu.value ? hitByType.value?.[type] : null
    const color = FACILITY_COLORS_MAP[type] || FACILITY_COLORS[0]
    for (const p of pool) {
      if (hits && (!p.id || !hits.has(p.id))) continue
      mixed.push({ lng: p.lng, lat: p.lat, color })
    }
  }
  if (mixed.length > 0) startFacilityBreathing(mixed)
}

// 显隐指标 → 呼吸绑定：图层控制面板开关「附近设施」即停/恢复设施呼吸
watch(isFacilityLayerVisible, () => syncFacilityBreathing())

/**
 * 分析完成定位：飞到分析结果所属城市中心（CityKey → CITY_CENTERS 单一权威源）。
 * 原实现调 zoomToDistrict()，其 VIEW_LEVELS.DISTRICT center 硬编码钦州 ——
 * 无论分析哪座城市，地图永远跳回钦州市区（切城分析跳错城 bug）。
 * currentCity 为 null 时（理论不可达：analyze 前已拦跨城）不动相机。
 */
function flyToAnalyzedCity(): void {
  const name = currentCity.value ? CITY_CENTER_NAMES[currentCity.value] : null
  const target = name ? MAP_CONFIG.CITY_CENTERS[name] : null
  if (!target) return
  flyTo({ lng: target.lng, lat: target.lat }, { height: target.height, zoom: target.zoom })
}

/** 雷达轴名点击：点亮该类型（6 类互斥——同时只允许一类呼吸，新类型点亮即熄灭旧类型） */
function handleShowFacilityLayer(data: {
  type: string
  poiList: FacilityPoint[]
  color: string
  label: string
}): void {
  activeBreathTypes.value = new Set([data.type])
  syncFacilityBreathing()
}

/**
 * 雷达轴名取消：熄灭该类型。点亮状态与图层显隐解耦——
 * 面板隐藏图层时呼吸停（watch 联动），重新显示且仍有点亮类型则恢复
 */
function handleHideFacilityLayer(type: string): void {
  activeBreathTypes.value = new Set([...activeBreathTypes.value].filter((t) => t !== type))
  syncFacilityBreathing()
}

/** 点击小区列表项（地图可视化已由列表面板内置处理） */
function handleSelectXiaoqu(xq: ScoredXiaoqu): void {
  // 更新本地状态，用于雷达图传参。
  // 坐标不做 ?? 0 哨兵（crs.ts 禁令——哨兵点会渲染到几内亚湾）；
  // 雷达图仅消费 breakdown/score/name，坐标原样透传
  logger.debug('[SiteSelection] 点击小区:', xq)
  logger.debug('[SiteSelection] breakdown:', xq.breakdown)

  selectedXiaoqu.value = {
    ...xq,
    score: xq.score ?? 0,
    breakdown: xq.breakdown || {},
  }
  // 层层筛选：结果列表管命中透明度与命中点呼吸，类型聚焦呼吸归雷达管
  applyHitHighlight(xq)
}

/**
 * 选中小区后计算命中设施集合并整体重建附近设施层：
 * 该小区覆盖半径内的参与点激活（opacity 1 原色亮），其余参与点保持低暗。
 * 半径走 effectiveRadiusKm（importance 档位换算）与后端 buffer 同口径
 */
function applyHitHighlight(xq: ScoredXiaoqu): void {
  const importanceByType = currentImportance()
  const next: Record<string, Set<string>> = {}
  for (const t of selectedTypes.value) {
    const pois = participatingPoi.value[t]
    if (!pois || pois.length === 0) continue
    next[t] = computeHitPoiIds(xq, pois, effectiveRadiusKm(t, importanceByType[t]))
  }
  hitByType.value = next
  syncFacilityPoiLayer()
  // 第二层筛选：选中小区 → 命中点收窄呼吸（雷达点亮类型时聚焦该类型单色）
  syncFacilityBreathing()
}

/**
 * 跳转逻辑由 PaginatedListPanel 提供（flyTo 回调 prop），与浸没分析统一。
 * 坐标非有限值（脏数据/旧快照）时跳过地图动作，不落 (0,0)
 */
function flyToXiaoqu(xq: ScoredXiaoqu): void {
  if (!Number.isFinite(xq.lng) || !Number.isFinite(xq.lat)) {
    logger.debug(`[SiteSelection] 小区 ${xq.id} 坐标无效，跳过地图定位`)
    return
  }
  startBreathing({ lng: xq.lng, lat: xq.lat })
  flyTo({ lng: xq.lng, lat: xq.lat }, { height: 1000 })
}

/** 路由守卫：仅跳转个人中心时保存状态，其他路由清除 */
onBeforeRouteLeave((to) => {
  if (to.path === '/profile') {
    // 跳转到个人中心，保存当前状态
    saveCurrentState()
  } else {
    // 跳转到其他路由，清除状态
    stateStore.clearState()
  }
})

/**
 * 保存当前页面状态到 store
 */
function saveCurrentState(): void {
  const factorSettings = factorPanelRef.value?.getSettings?.() || null

  stateStore.saveState({
    factorSettings,
    matchedXiaoqu: matchedXiaoqu.value,
    selectedTypes: selectedTypes.value,
    facilityPoi: facilityPoi.value, // 补保存设施POI
  })
}

/**
 * 恢复保存的状态
 */
function restoreState(): boolean {
  const savedState = stateStore.consumeState()
  if (!savedState) return false

  // 恢复分析结果（store 单一来源，快照恢复只写 store；consumeState 已强类型返回）
  stateStore.setResult({
    matchedXiaoqu: savedState.matchedXiaoqu || [],
    selectedTypes: savedState.selectedTypes || [],
    facilityPoi: savedState.facilityPoi || {},
  })
  // 恢复因子面板状态
  const factorSettings = savedState.factorSettings
  if (factorSettings && factorPanelRef.value?.restoreSettings) {
    factorPanelRef.value.restoreSettings(factorSettings)
  }

  // 如果有分析结果，触发结果更新
  if (matchedXiaoqu.value.length > 0) {
    // 传全量字段，避免 handleResult 用空值覆盖已恢复状态
    handleResult({
      matchedXiaoqu: matchedXiaoqu.value,
      selectedTypes: selectedTypes.value,
      facilityPoi: facilityPoi.value,
    })
  }

  return true
}

/** 清除旧分析图层（覆盖范围 + 匹配小区 + 附近设施） */
function clearAnalysisLayers(): void {
  // 通过 Manager 统一管理生命周期，不直接操作 renderer 和 mapStore
  if (businessLayerManager.has('analysis-coverage')) {
    businessLayerManager.remove('analysis-coverage')
  }
  if (businessLayerManager.has('analysis-matched')) {
    businessLayerManager.remove('analysis-matched')
  }

  // 附近设施走 manager 生命周期，避免绕过管理残留在注册表导致引擎切换时孤儿复活
  if (businessLayerManager.has(NEARBY_FACILITY_LAYER_ID)) {
    businessLayerManager.remove(NEARBY_FACILITY_LAYER_ID)
  }
  stopFacilityBreathing()
  participatingPoi.value = {}
  hitByType.value = null
  activeBreathTypes.value = new Set()
}

onMounted(() => {
  // 尝试恢复保存的状态（从个人中心返回）
  const restored = restoreState()

  if (restored) {
    // 从个人中心返回，保留状态，不清除图层
  } else {
    // 非个人中心返回，清除旧分析图层
    clearAnalysisLayers()
    // 等待渲染器就绪后再缩放，最多重试10次
    let retries = 0
    const tryZoom = () => {
      if (mapInstance.value?.getRenderer?.()) {
        zoomToCity()
      } else if (retries < 10) {
        retries++
        // 保存定时器 id，卸载时清理
        tryZoomTimer = setTimeout(tryZoom, 500)
      }
    }
    tryZoom()
  }
})

onUnmounted(() => {
  stopBreathing()
  stopFacilityBreathing()
  // 清理悬挂的 tryZoom 定时器
  if (tryZoomTimer) {
    clearTimeout(tryZoomTimer)
    tryZoomTimer = null
  }
  // 统一清理分析图层（clearAnalysisLayers 已含设施 POI，避免双清）；DEM 图层仅属洪涝分析，不在此清理
  clearAnalysisLayers()
})
</script>

<template>
  <div class="site-selection-page">
    <AppLayout>
      <!-- 左侧：左上雷达图 + 左下小区名单 -->
      <template #left>
        <!-- 左上：小区雷达图 4×4（显示选中小区或第一名） -->
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <RadarChart
            :visible="true"
            :embedded="true"
            :xiaoqu="displayXiaoquForRadar"
            :selected-types="radarSelectedTypes"
            :facility-poi="facilityPoi"
            @show-facility-layer="handleShowFacilityLayer"
            @hide-facility-layer="handleHideFacilityLayer"
          />
        </GCSPanel>
        <!-- 左下：小区名单列表 4×4 -->
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <PaginatedListPanel
            :items="displayXiaoqu"
            :page-size="4"
            :loading="calculating"
            title="小区名单"
            empty-text="暂无分析结果"
            plan-type="site-selection"
            :fly-to="flyToXiaoqu"
            @click-item="handleSelectXiaoqu"
          >
            <template #item="{ item: xq, index }">
              <span class="xq-rank">{{ index + 1 }}</span>
              <span class="xq-name">{{ xq.name }}</span>
              <span class="xq-score">{{ xq.score }}分</span>
            </template>
          </PaginatedListPanel>
        </GCSPanel>
      </template>

      <!-- 右侧：右上因子面板 + 右下图层控制 -->
      <template #right>
        <!-- 右上：设施因子选择面板 4×4 -->
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <SiteAnalysisControlPanel
            ref="factorPanelRef"
            :city="currentCity"
            @result-update="handleResult"
            @analysis-error="handleAnalysisError"
            @analysis-empty="handleAnalysisEmpty"
            @cross-city="handleCrossCity"
          />
        </GCSPanel>
        <!-- 右下：图层控制面板 4×4 -->
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel
            :layer-order="[
              'base-image',
              'base-vector',
              'boundary',
              'ports',
              'analysis-coverage',
              'analysis-matched',
              'nearby-facility',
            ]"
          />
        </GCSPanel>
      </template>
    </AppLayout>
  </div>
</template>

<style scoped>
.site-selection-page {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.xq-rank {
  color: var(--GCS-text-muted);
  font-size: 12px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.xq-name {
  color: var(--GCS-text-primary);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  text-align: center;
  min-width: 0;
}

.xq-score {
  color: var(--GCS-color-primary);
  font-weight: 600;
  flex-shrink: 0;
  min-width: 50px;
  text-align: right;
}
</style>
