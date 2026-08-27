<script setup lang="ts">
/**
 * 选址分析业务页：左上雷达图（第一名/选中小区）、左下小区名单、
 * 右上设施因子面板、右下图层控制（各 4×4）。
 * 跳转个人中心时保存状态、返回恢复，跳其他路由清除。
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { storeToRefs } from 'pinia'

import { AppLayout, GCSPanel, LayerControlPanel, useBusinessLayers, useMapControls } from '@/core'
import { showError, showWarning } from '@/shared'
import { logger } from '@/shared'
import { PaginatedListPanel } from '@/shared'
import { useSiteSelectionStore } from '@/stores'
import type { AnalysisResult, FacilityPoint, ScoredXiaoqu } from '@/types/analysis'
import { RadarChart } from '@/visualization'

import SiteAnalysisControlPanel from './components/SiteAnalysisControlPanel.vue'
import { useAnalysisLayer } from './composables/useAnalysisLayer'

const { flyTo, startBreathing, stopBreathing, zoomToCity, zoomToDistrict, mapInstance } =
  useMapControls()
const stateStore = useSiteSelectionStore()
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

/** 当前方案ID（用于保存小区） */
const currentPlanId = ref<string | null>(null)

/** 当前显示的设施POI图层key（互斥） */
const activeFacilityLayerKey = ref<string | null>(null)

/** 因子面板引用（用于获取/恢复状态） */
const factorPanelRef = ref<InstanceType<typeof SiteAnalysisControlPanel> | null>(null)

/** 小区列表面板引用（用于获取/恢复状态） */
const favoriteListRef = ref<InstanceType<typeof PaginatedListPanel> | null>(null)

/** 处理分析错误（来自因子面板的 calcError） */
function handleAnalysisError(message: string): void {
  showError(message, { fallback: '选址分析失败，请调整筛选条件后重试' })
}

/** 8-1：无重叠区域 = 合法业务空结果（02 §4.1），提示用户调整条件而非报错 */
function handleAnalysisEmpty(reason: string): void {
  showWarning(reason)
}

/** 限制显示前8个小区 */
const displayXiaoqu = computed<ScoredXiaoqu[]>(() => matchedXiaoqu.value.slice(0, 8))

/** 第一名小区（雷达图默认显示） */
const topXiaoqu = computed<ScoredXiaoqu | null>(() => matchedXiaoqu.value[0] || null)

/** 当前显示的小区（选中优先，其次第一名；未分析时为 null → 雷达图显示空态） */
const displayXiaoquForRadar = computed<ScoredXiaoqu | null>(
  () => selectedXiaoqu.value || topXiaoqu.value
)

/** 雷达图指标：跟随已选设施类型 */
const radarSelectedTypes = computed<string[]>(() => selectedTypes.value)

/** 处理分析结果 */
function handleResult(result: Partial<AnalysisResult>): void {
  logger.debug('[SiteSelection] 收到分析结果:', result)

  // 图层更新直调 updateAnalysisHandler；分析结果恢复走 useSiteSelectionStore 内存快照
  void updateAnalysisHandler(result)
  // 816-专项2 4-3：store 单一来源——setResult 同时驱动页面与 AppLayout 全局雷达（删本地双写）
  stateStore.setResult({
    matchedXiaoqu: result.matchedXiaoqu || [],
    selectedTypes: result.selectedTypes || [],
    facilityPoi: result.facilityPoi || {},
  })
  selectedXiaoqu.value = null
  stopBreathing()
  if (matchedXiaoqu.value.length > 0) {
    zoomToDistrict()
  }
}

/** 显示指定设施的 POI 图层（互斥，经 BLM 注册） */
function handleShowFacilityLayer(data: {
  type: string
  poiList: FacilityPoint[]
  color: string
  label: string
}): void {
  // 先移除旧的设施POI图层
  if (activeFacilityLayerKey.value) {
    businessLayerManager.remove(activeFacilityLayerKey.value)
    activeFacilityLayerKey.value = null
  }

  const { type, poiList, color, label } = data
  if (!poiList || poiList.length === 0) return

  const layerKey = `facility-poi-${type}`
  const points = poiList.map((p) => ({
    lng: p.lng,
    lat: p.lat,
    name: p.name || label,
  }))

  businessLayerManager.register(layerKey, {
    label: `${label} POI`,
    layerType: 'points',
    data: points,
    options: {
      size: 8,
      color,
      labelField: 'name',
      featureType: layerKey,
    },
    visible: true,
  })

  activeFacilityLayerKey.value = layerKey
}

/**
 * 隐藏当前设施POI图层
 */
function handleHideFacilityLayer(): void {
  if (!activeFacilityLayerKey.value) return
  businessLayerManager.remove(activeFacilityLayerKey.value)
  activeFacilityLayerKey.value = null
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
  startBreathing(xq.lng, xq.lat)
  flyTo({ lng: xq.lng, lat: xq.lat }, { height: 1000 })
}

/** 收藏状态变化时同步方案ID */
function handleFavoriteChange(_data: { item: ScoredXiaoqu; isFavorite: boolean }): void {
  const planId = favoriteListRef.value?.getCurrentPlanId()
  if (planId && !currentPlanId.value) {
    currentPlanId.value = planId
  }
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
  const savedXiaoquIds = favoriteListRef.value?.getSavedIds?.() || []

  stateStore.saveState({
    factorSettings,
    matchedXiaoqu: matchedXiaoqu.value,
    selectedTypes: selectedTypes.value,
    facilityPoi: facilityPoi.value, // 补保存设施POI
    currentPlanId: currentPlanId.value,
    savedXiaoquIds,
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
  currentPlanId.value = savedState.currentPlanId || null

  // 恢复因子面板状态
  const factorSettings = savedState.factorSettings
  if (factorSettings && factorPanelRef.value?.restoreSettings) {
    factorPanelRef.value.restoreSettings(factorSettings)
  }

  // 恢复小区结果面板状态（方案ID从savedXiaoquIds推断，实际收藏由服务端管理）
  if (savedState.currentPlanId) {
    currentPlanId.value = savedState.currentPlanId
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

/** 清除旧分析图层（覆盖范围 + 匹配小区 + 设施 POI） */
function clearAnalysisLayers(): void {
  // 通过 Manager 统一管理生命周期，不直接操作 renderer 和 mapStore
  if (businessLayerManager.has('analysis-coverage')) {
    businessLayerManager.remove('analysis-coverage')
  }
  if (businessLayerManager.has('analysis-matched')) {
    businessLayerManager.remove('analysis-matched')
  }

  // 设施 POI 图层同样走 manager 生命周期，避免绕过管理残留在注册表导致引擎切换时孤儿复活
  if (activeFacilityLayerKey.value) {
    businessLayerManager.remove(activeFacilityLayerKey.value)
    activeFacilityLayerKey.value = null
  }
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
            ref="favoriteListRef"
            :items="displayXiaoqu"
            :page-size="4"
            :loading="calculating"
            title="小区名单"
            empty-text="暂无分析结果"
            plan-type="site-selection"
            plan-name-prefix="选址分析收藏"
            :fly-to="flyToXiaoqu"
            @click-item="handleSelectXiaoqu"
            @favorite-change="handleFavoriteChange"
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
            @result-update="handleResult"
            @analysis-error="handleAnalysisError"
            @analysis-empty="handleAnalysisEmpty"
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
