<script setup lang="ts">
/**
 * SiteSelectionPage - 选址分析业务页
 *
 * 布局（继承 Home Layout，替换 slot 内容）：
 * - 左上（4×4）：第一名小区雷达图
 * - 左下（4×4）：图层控制面板（接入真实功能）
 * - 右上（4×4）：设施因子选择面板（6 按钮 + 滑块 + 清空/分析）
 * - 右下（4×4）：小区名单列表
 *
 * 顶部标题 + 城市按钮 + 底部导航条固定不变。
 *
 * 状态保存机制：
 * - 跳转到个人中心（/profile）时保存当前状态
 * - 从个人中心返回时恢复状态
 * - 跳转到其他路由时清除状态
 */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

import { useBusinessLayers, useMapControls } from '@/core'
import AppLayout from '@/core/layout/AppLayout.vue'
import GCSPanel from '@/core/layout/components/GCSPanel.vue'
import LayerControlPanel from '@/core/map/components/LayerControlPanel.vue'
import { showError } from '@/shared'
import { logger } from '@/shared'
import PaginatedListPanel from '@/shared/components/PaginatedListPanel.vue'
import type { SiteSelectionState } from '@/stores'
import { useMapStore } from '@/stores'
import { useSiteSelectionStateStore } from '@/stores'
import type { AnalysisResult, FacilityPoint, ScoredXiaoqu } from '@/types/analysis'
import RadarChart from '@/visualization/charts/RadarChart.vue'

import SiteAnalysisControlPanel from './components/SiteAnalysisControlPanel.vue'
import { useAnalysisLayer } from './composables/useAnalysisLayer'

const { flyTo, startBreathing, stopBreathing, zoomToCity, zoomToDistrict, mapInstance } =
  useMapControls()
const mapStore = useMapStore()
const stateStore = useSiteSelectionStateStore()
const { manager: businessLayerManager } = useBusinessLayers()
const { createUpdateHandler } = useAnalysisLayer() as unknown as {
  createUpdateHandler: (_manager: unknown) => (_result: unknown) => Promise<void>
}

// 保存定时器 id，卸载时清理悬挂定时器
let tryZoomTimer: ReturnType<typeof setTimeout> | null = null

/** 分析结果 */
const matchedXiaoqu = ref<ScoredXiaoqu[]>([])
const selectedTypes = ref<string[]>([])
const selectedXiaoqu = ref<ScoredXiaoqu | null>(null)

/** 覆盖范围内的设施POI数据 { type: [{lng, lat, name}] } */
const facilityPoi = ref<Record<string, FacilityPoint[]>>({})

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

/** 限制显示前8个小区 */
const displayXiaoqu = computed<ScoredXiaoqu[]>(() => matchedXiaoqu.value.slice(0, 8))

/** 第一名小区（雷达图默认显示） */
const topXiaoqu = computed<ScoredXiaoqu | null>(() => matchedXiaoqu.value[0] || null)

/** 当前显示的小区（优先显示选中的，否则显示第一名） */
const displayXiaoquForRadar = computed<ScoredXiaoqu | null>(
  () => selectedXiaoqu.value || topXiaoqu.value
)

/** 处理分析结果 */
function handleResult(result: Partial<AnalysisResult>): void {
  logger.debug('[SiteSelection] 收到分析结果:', result)

  // 注册分析结果处理函数（通过 BusinessLayerManager 管理图层）
  if (!mapStore.analysisHandler) {
    const updateHandler = createUpdateHandler(businessLayerManager)
    mapStore.registerAnalysisHandler(updateHandler)
  }

  mapStore.setAnalysisResult(result)
  matchedXiaoqu.value = result.matchedXiaoqu || []
  selectedTypes.value = result.selectedTypes || []
  facilityPoi.value = result.facilityPoi || {}
  selectedXiaoqu.value = null
  mapStore.setSelectedXiaoqu(null)
  stopBreathing()
  if (matchedXiaoqu.value.length > 0) {
    zoomToDistrict()
  }
}

/**
 * 显示指定设施的POI图层（互斥，只显示一个）
 * a014: 统一经 businessLayerManager 注册，不再直调 renderer
 */
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

/** 点击小区列表项（地图可视化已由FavoriteListPanel内置处理） */
function handleSelectXiaoqu(xq: ScoredXiaoqu): void {
  // 更新本地状态，用于雷达图传参
  logger.debug('[SiteSelection] 点击小区:', xq)
  logger.debug('[SiteSelection] breakdown:', xq.breakdown)

  const normalizedXq: ScoredXiaoqu = {
    id: xq.id,
    name: xq.name,
    lng: xq.lng ?? 0,
    lat: xq.lat ?? 0,
    score: xq.score ?? 0,
    breakdown: xq.breakdown || {},
  }

  selectedXiaoqu.value = normalizedXq
  // z053: 从 PaginatedListPanel 上提至此（shared 不再依赖 stores）
  mapStore.setSelectedXiaoqu(normalizedXq)
  // z054: 从 PaginatedListPanel 上提至此（shared 不再依赖 core）
  startBreathing(normalizedXq.lng, normalizedXq.lat)
  flyTo({ lng: normalizedXq.lng, lat: normalizedXq.lat }, { height: 1000 })
}

/** 收藏状态变化时同步方案ID */
function handleFavoriteChange(_data: { item: ScoredXiaoqu; isFavorite: boolean }): void {
  const planId = favoriteListRef.value?.getCurrentPlanId()
  if (planId && !currentPlanId.value) {
    currentPlanId.value = planId
  }
}

/**
 * 路由守卫：离开选址分析页时保存/清除状态
 * 规则：仅当跳转到个人中心时保存状态，其他路由清除状态
 */
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

  // 恢复分析结果
  matchedXiaoqu.value = (savedState as SiteSelectionState).matchedXiaoqu || []
  selectedTypes.value = (savedState as SiteSelectionState).selectedTypes || []
  facilityPoi.value = (savedState as SiteSelectionState).facilityPoi || {}
  currentPlanId.value = (savedState as SiteSelectionState).currentPlanId || null

  // 恢复因子面板状态
  const factorSettings = (savedState as SiteSelectionState).factorSettings
  if (factorSettings && factorPanelRef.value?.restoreSettings) {
    factorPanelRef.value.restoreSettings(factorSettings)
  }

  // 恢复小区结果面板状态（方案ID从savedXiaoquIds推断，实际收藏由服务端管理）
  if ((savedState as SiteSelectionState).currentPlanId) {
    currentPlanId.value = (savedState as SiteSelectionState).currentPlanId
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

/**
 * 清除旧的分析图层（分析覆盖范围 + 匹配小区 + 设施POI）
 * 从 mapStore catalog 和 renderer 中同时移除
 */
function clearAnalysisLayers(): void {
  // 通过 Manager 统一管理生命周期，不直接操作 renderer 和 mapStore
  if (businessLayerManager.has('analysis-coverage')) {
    businessLayerManager.remove('analysis-coverage')
  }
  if (businessLayerManager.has('analysis-matched')) {
    businessLayerManager.remove('analysis-matched')
  }

  // 清除设施POI图层 — 走 manager 统一生命周期（与上面两块一致），避免绕过 manager 残留在 _registry 中
  // 导致引擎切换时 App.vue reapplyAll 按 registry 重绘出已删图层的「孤儿复活」（P0-4）
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
  // @arch-note a013: 统一清理所有分析图层（analysis-coverage/analysis-matched + 设施POI）
  // clearAnalysisLayers 内部已处理设施 POI，不再单独调 handleHideFacilityLayer 避免双清
  // @arch-note a017: DEM 山体阴影（真实地形）图层仅属洪涝分析，选址页不注册不清理
  clearAnalysisLayers()
})
</script>

<template>
  <div class="site-selection-page">
    <AppLayout>
      <!-- 左侧：左上雷达图 + 左下图层控制 -->
      <template #left>
        <!-- 左上：小区雷达图 4×4（显示选中小区或第一名） -->
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <RadarChart
            :visible="true"
            :embedded="true"
            :xiaoqu="displayXiaoquForRadar"
            :selected-types="selectedTypes"
            :facility-poi="facilityPoi"
            @show-facility-layer="handleShowFacilityLayer"
            @hide-facility-layer="handleHideFacilityLayer"
          />
        </GCSPanel>
        <!-- 左下：图层控制面板 4×4 -->
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel />
        </GCSPanel>
      </template>

      <!-- 右侧：右上因子面板 + 右下小区名单 -->
      <template #right>
        <!-- 右上：设施因子选择面板 4×4 -->
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <SiteAnalysisControlPanel
            ref="factorPanelRef"
            @result-update="handleResult"
            @analysis-error="handleAnalysisError"
          />
        </GCSPanel>
        <!-- 右下：小区名单列表 4×4 -->
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <PaginatedListPanel
            ref="favoriteListRef"
            :items="displayXiaoqu"
            :page-size="4"
            title="小区名单"
            empty-text="暂无分析结果"
            plan-type="site-selection"
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
