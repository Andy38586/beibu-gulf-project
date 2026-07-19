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

import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import AppLayout from '@/core/layout/AppLayout.vue'
import GcsPanel from '@/core/layout/components/GcsPanel.vue'
import SiteFactorPanel from './components/SiteFactorPanel.vue'
import SiteLayerPanel from './components/SiteLayerPanel.vue'
import XiaoquResultPanel from './components/XiaoquResultPanel.vue'
import RadarChart from '@/visualization/charts/RadarChart.vue'
import { useMapControls } from '@/core/map/composables/useMapControls'
import { useMapStore } from '@/stores/map'
import { usePlans } from '@/shared/composables/usePlans'
import { useSiteSelectionStateStore } from '@/stores/siteSelectionState'
import { useLayerManager } from '@/core/map/composables/useLayerManager'
import { FACILITY_CONFIG } from './composables/useFacilities'
import { FACILITY_LABELS } from '@/shared/utils/facilityLabels'
import type { ScoredXiaoqu } from '@/types/xiaoqu'
import type { FacilityType, TypeSetting, FacilityPoint } from '@/types/facility'
import type { AnalysisResult } from '@/types/analysis'

const router = useRouter()
const { flyTo, startBreathing, stopBreathing, zoomToCity, zoomToDistrict, mapInstance } = useMapControls()
const mapStore = useMapStore()
const { saveXiaoqu, removeXiaoqu, createPlan } = usePlans()
const stateStore = useSiteSelectionStateStore()
const { registerToggleable, toggleLayer } = useLayerManager()

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
const factorPanelRef = ref<InstanceType<typeof SiteFactorPanel> | null>(null)

/** 小区结果面板引用（用于获取/恢复状态） */
const xiaoquResultPanelRef = ref<InstanceType<typeof XiaoquResultPanel> | null>(null)

/** 限制显示前8个小区 */
const displayXiaoqu = computed<ScoredXiaoqu[]>(() => matchedXiaoqu.value.slice(0, 8))

/** 第一名小区（雷达图默认显示） */
const topXiaoqu = computed<ScoredXiaoqu | null>(() => matchedXiaoqu.value[0] || null)

/** 当前显示的小区（优先显示选中的，否则显示第一名） */
const displayXiaoquForRadar = computed<ScoredXiaoqu | null>(() => selectedXiaoqu.value || topXiaoqu.value)

/** 处理分析结果 */
function handleResult(result: Partial<AnalysisResult>): void {
  mapStore.setAnalysisResult(result)
  matchedXiaoqu.value = result.matchedXiaoqu || []
  selectedTypes.value = (result as any).selectedTypes || []
  facilityPoi.value = (result as any).facilityPoi || {}
  selectedXiaoqu.value = null
  mapStore.setSelectedXiaoqu(null)
  stopBreathing()
  if (matchedXiaoqu.value.length > 0) {
    zoomToDistrict()
  }
}

/**
 * 显示指定设施的POI图层（互斥，只显示一个）
 */
function handleShowFacilityLayer(data: {
  type: string
  poiList: FacilityPoint[]
  color: string
  label: string
}): void {
  const renderer = mapInstance.value?.getRenderer?.()
  if (!renderer) return

  // 先移除旧的设施POI图层
  if (activeFacilityLayerKey.value) {
    renderer.removeLayer(activeFacilityLayerKey.value)
    mapStore.removeLayer(activeFacilityLayerKey.value)
    activeFacilityLayerKey.value = null
  }

  const { type, poiList, color, label } = data
  if (!poiList || poiList.length === 0) return

  const layerKey = `facility-poi-${type}`
  const points = poiList.map((p) => ({
    lon: p.lng,
    lat: p.lat,
    name: p.name || label,
  }))

  renderer.addPointLayer(layerKey, points, {
    size: 8,
    color,
    labelField: 'name',
    featureType: layerKey,
  })

  registerToggleable(layerKey, `${label} POI`, renderer)
  activeFacilityLayerKey.value = layerKey
}

/**
 * 隐藏当前设施POI图层
 */
function handleHideFacilityLayer(): void {
  if (!activeFacilityLayerKey.value) return

  const renderer = mapInstance.value?.getRenderer?.()
  if (renderer) {
    renderer.removeLayer(activeFacilityLayerKey.value)
  }
  mapStore.removeLayer(activeFacilityLayerKey.value)
  activeFacilityLayerKey.value = null
}

/** 点击小区列表项 */
function handleSelectXiaoqu(xq: ScoredXiaoqu): void {
  selectedXiaoqu.value = xq
  mapStore.setSelectedXiaoqu(xq)
  if ((xq as any).lon && (xq as any).lat) {
    startBreathing((xq as any).lon, (xq as any).lat)
    flyTo({ lng: (xq as any).lon, lat: (xq as any).lat }, { height: 5000 })
  }
}

/** 保存小区到方案（无方案时自动创建） */
async function handleSaveXiaoqu(data: { planId: string | null; xiaoqu: ScoredXiaoqu }): Promise<void> {
  let pid = data.planId
  if (!pid) {
    // 自动创建方案：名称=分析结果时间戳
    const planName = `选址方案_${new Date().toLocaleTimeString()}`
    const typeSettings: Record<string, TypeSetting> = {}
    selectedTypes.value.forEach((key) => {
      typeSettings[key] = { selected: true, importance: 3, defaultRadius: 0 }
    })
    try {
      const plan = await createPlan(planName, typeSettings)
      pid = plan?.id || null
      if (pid) {
        currentPlanId.value = pid
      }
    } catch (error) {
      console.error('自动创建方案失败:', error)
      return
    }
  }
  if (!pid) return
  try {
    await saveXiaoqu(pid, data.xiaoqu)
    console.log('小区保存成功:', data.xiaoqu.name)
  } catch (error) {
    console.error('保存小区失败:', error)
  }
}

/** 从方案中移除小区 */
async function handleRemoveXiaoqu(data: { planId: string | null; xiaoquId: string }): Promise<void> {
  if (!data.planId) {
    console.warn('未选择方案，无法移除小区')
    return
  }
  try {
    await removeXiaoqu(data.planId, data.xiaoquId)
    console.log('小区移除成功')
  } catch (error) {
    console.error('移除小区失败:', error)
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
  const savedXiaoquIds = xiaoquResultPanelRef.value?.getSavedIds?.() || []

  stateStore.saveState({
    factorSettings,
    matchedXiaoqu: matchedXiaoqu.value,
    selectedTypes: selectedTypes.value,
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
  matchedXiaoqu.value = (savedState as any).matchedXiaoqu || []
  selectedTypes.value = (savedState as any).selectedTypes || []
  currentPlanId.value = (savedState as any).currentPlanId || null

  // 恢复因子面板状态
  if ((savedState as any).factorSettings && factorPanelRef.value?.restoreSettings) {
    factorPanelRef.value.restoreSettings((savedState as any).factorSettings)
  }

  // 恢复小区结果面板状态
  if ((savedState as any).savedXiaoquIds && xiaoquResultPanelRef.value?.restoreSavedIds) {
    xiaoquResultPanelRef.value.restoreSavedIds((savedState as any).savedXiaoquIds)
  }

  // 如果有分析结果，触发结果更新
  if (matchedXiaoqu.value.length > 0) {
    handleResult({
      matchedXiaoqu: matchedXiaoqu.value,
    })
  }

  return true
}

/**
 * 清除旧的分析图层（分析覆盖范围 + 匹配小区 + 设施POI）
 * 从 mapStore catalog 和 renderer 中同时移除
 */
function clearAnalysisLayers(): void {
  const renderer = mapInstance.value?.getRenderer?.()

  // 清除分析覆盖范围和匹配小区图层
  mapStore.removeLayer('analysis-coverage')
  mapStore.removeLayer('analysis-matched')
  if (renderer) {
    renderer.removeLayer('analysis-coverage')
    renderer.removeLayer('analysis-matched')
  }

  // 清除设施POI图层
  if (activeFacilityLayerKey.value) {
    mapStore.removeLayer(activeFacilityLayerKey.value)
    if (renderer) {
      renderer.removeLayer(activeFacilityLayerKey.value)
    }
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
    // 正常初始化
    setTimeout(() => zoomToCity(), 300)
  }
})

onUnmounted(() => {
  stopBreathing()
})
</script>

<template>
  <div class="site-selection-page">
    <AppLayout>
      <!-- 左侧：左上雷达图 + 左下图层控制 -->
      <template #left>
        <!-- 左上：小区雷达图 4×4（显示选中小区或第一名） -->
        <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <RadarChart
            :embedded="true"
            :xiaoqu="displayXiaoquForRadar"
            :selected-types="selectedTypes"
            :facility-poi="facilityPoi"
            @show-facility-layer="handleShowFacilityLayer"
            @hide-facility-layer="handleHideFacilityLayer"
          />
        </GcsPanel>
        <!-- 左下：图层控制面板 4×4 -->
        <GcsPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <SiteLayerPanel />
        </GcsPanel>
      </template>

      <!-- 右侧：右上因子面板 + 右下小区名单 -->
      <template #right>
        <!-- 右上：设施因子选择面板 4×4 -->
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="1.25">
          <SiteFactorPanel ref="factorPanelRef" @result-update="handleResult" />
        </GcsPanel>
        <!-- 右下：小区结果面板 4×4（8个按钮，双状态） -->
        <GcsPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <XiaoquResultPanel
            ref="xiaoquResultPanelRef"
            :xiaoqu-list="displayXiaoqu"
            :plan-id="currentPlanId"
            @select-xiaoqu="handleSelectXiaoqu"
            @save-xiaoqu="handleSaveXiaoqu"
            @remove-xiaoqu="handleRemoveXiaoqu"
          />
        </GcsPanel>
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
</style>
