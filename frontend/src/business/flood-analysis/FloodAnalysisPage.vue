<script setup lang="ts">
/**
 * 浸没分析模块：数据源经 floodAdapter（数据源适配层）隔离（Nest /flood/* 单模式），
 * 业务图层经 BusinessLayerManager（BLM）独立注册/销毁；3D 渲染器不依赖 2D 引擎独立承载业务，
 * 相机（height<->zoom）2D/3D 切换同步。切换数据源仅改 adapter，业务代码零改动。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import {
  AppLayout,
  GCSPanel,
  isWater3DCapable,
  LayerControlPanel,
  TaskPanelSlot,
  useBusinessLayers,
} from '@/core'
import { floodAdapter } from '@/services'
import {
  LAYER_FILL_WATER,
  logger,
  showWarning,
  useLatestRequest,
  useProfileSnapshot,
} from '@/shared'
import { useFloodStore, useTaskStore } from '@/stores'
import { useMapStore } from '@/stores'
import type { AffectedFacility, FloodFeature, FloodStatistics } from '@/types/business/base'
import type { TaskSlot } from '@/types/task'

import AffectedFacilityListPanel from './components/AffectedFacilityListPanel.vue'
import FloodAnalysisReportPanel from './components/FloodAnalysisReportPanel.vue'
import WaterLevelProfilePanel from './components/WaterLevelProfilePanel.vue'
import { FLOOD_ANALYSIS_DELAY, FLOOD_ROUTE_PATH } from './composables/useFloodRequest'
import { FLOOD_RISK_COLORS, FLOOD_RISK_DEFAULT } from './constants/colors'

// waterLevel/portImpact/profile 三 store 已并入 floodStore，统一从此取
const floodStore = useFloodStore()
const mapStore = useMapStore()
const taskStore = useTaskStore()
const { manager: businessLayerManager } = useBusinessLayers()

/** v4：本页路由标识（taskStore 按 route 分槽的 key）——单一事实源在 useFloodRequest */
const ROUTE_PATH = FLOOD_ROUTE_PATH

/** v4：本路由任务槽（驱动水位控制面板的停靠态） */
const floodTaskSlot = computed<TaskSlot | null>(() => taskStore.getSlot(ROUTE_PATH))

/**
 * v4：面板被拖入投递区 ⇒ 确保本路由有任务，并把该任务标记为「让位排队」。
 *
 * 🔴 不能只 `setDocked(route, true)`：`docked` 标记住在 `TaskSlot` 上，
 *    而槽位只在提交任务时创建。只设标记 ⇒ 槽不存在 ⇒ store 直接 return，
 *    表现为「拖了但没反应」。提交逻辑在面板里（只有它知道"跑什么参数"）。
 *
 * 🔴 2026-09-19 语义修正：`setDocked(true)` **不是**收起面板 ——
 *    面板仍在原位可用；它只是把该路由任务的优先级降为后台排队（由 store 自动判定）。
 */
async function handleDock(): Promise<void> {
  const ok = await waterPanelRef.value?.dockToTask()
  if (ok) return
  // 失败：明确告知用户（不让"拖了没反应"成为静默失败）
  showWarning('任务提交失败，请稍后重试')
}

const route = useRoute()

/**
 * 状态恢复标志：恢复状态时禁止面板自动分析触发重复请求。
 *
 * 🔴 必须是 `ref` 而非 `let`：它会作为 prop 传给面板（`:state-restored`），
 *    普通变量不参与响应式追踪，面板拿到的是渲染那一刻的**快照值**（恒 false）。
 *    面板据此决定"挂载时要不要自动跑首屏"。
 */
const stateRestored = ref(false)

/** 水面高度更新防抖定时器（分析防抖已随请求迁至面板） */
let waterSurfaceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 水域坐标请求的 signal 供给。
 *
 * 只服务于 `registerFloodLayers` 里的水面/DEM 加载（属**渲染**资源，不是分析请求），
 * 故留在页面。分析请求的竞态守卫已迁入 `useFloodRequest`——那边会自己建 signal，
 * 页面这条**不覆盖分析请求**（否则会误 abort 掉面板发出的直连取数）。
 */
const { getCurrentSignal: getFloodSignal } = useLatestRequest()

const WATER_SURFACE_ID = 'flood-water-surface'

const FLOOD_LAYER_ID = 'flood-area'
const FACILITY_LAYER_ID = 'flood-facilities'
/** 洪涝设施点 featureType（与 FACILITY_LAYER_ID 前缀一致，防跨模块同名冲突） */
const FACILITY_FEATURE_TYPE = 'flood-facility-point'
/**
 * 地形山影（DEM 数字高程模型山体阴影）图层 ID。
 *
 * v5（2026-09-21）：由「用户可开关的业务图层」改为**随底图默认加载的基础能力**：
 * 默认可见、图层面板不列出、不可关闭。动因有两个：
 * ① 用户要求地形默认随底图加载、不进图层控制；
 * ② 它此前与真地形 z 起伏存在**非预期耦合**——geotiff 图层的 setVisibility 会连带
 *    调用 setTerrainEnabled，导致「关掉山影贴图」把立体起伏也一起关掉，与
 *    layerAdapters 自己注释的「DEM 与真地形互不耦合」相矛盾。
 * 现在两者彻底分开：z 起伏由 CesiumRenderer 挂载时自建（不可关），
 * 山影贴图仍**经 businessLayerManager 注册**（图层状态只有一个事实源，符合 04 清单 A4），
 * 只是以 `listed: false` 不进面板、以 `locked: true` 拒绝被关。
 */
const DEM_HILLSHADE_LAYER_ID = 'flood-dem-hillshade'

// 水域坐标经 floodAdapter 加载，按 dataSource（fetch/calculate）自动切换取数来源，业务代码零改动
let cachedWaterAreaCoords: [number, number][] | null = null

// 水域坐标加载失败时降级 null（仅水面图层跳过，其余图层照常）：原实现无 try/catch 会抛出未捕获
// rejection，现以 toast 告知且不阻塞其余图层；signal 支持卸载时取消在途请求
async function loadWaterAreaCoordinates(signal?: AbortSignal): Promise<[number, number][] | null> {
  if (cachedWaterAreaCoords) return cachedWaterAreaCoords
  try {
    cachedWaterAreaCoords = await floodAdapter.getWaterArea(signal)
    return cachedWaterAreaCoords
  } catch (error) {
    if (!signal?.aborted) {
      logger.warn('[FloodAnalysisPage] 水域坐标加载失败，水面图层跳过:', error)
      showWarning('水域数据加载失败，水面图层暂不可用（其余图层正常）')
    }
    return null
  }
}

/** 图层是否已注册（防止重复注册） */
let floodLayersRegistered = false

/** 移除 Cesium 独占图层（水面/地形山影）入口：引擎切回 2D 时调用，复位注册标志 */
function removeCesiumOnlyLayers() {
  if (businessLayerManager.has(WATER_SURFACE_ID)) businessLayerManager.remove(WATER_SURFACE_ID)
  if (businessLayerManager.has(DEM_HILLSHADE_LAYER_ID))
    businessLayerManager.remove(DEM_HILLSHADE_LAYER_ID)
  floodLayersRegistered = false
}

// 首次 register 仅建 catalog 条目（数据未就绪不渲染），API 返回数据后由 updateData 渲染
async function registerFloodLayers(signal?: AbortSignal) {
  if (floodLayersRegistered) return

  const waterCoords = await loadWaterAreaCoordinates(signal)
  if (unmounted) return

  floodLayersRegistered = true

  // 坐标加载失败时跳过水面图层注册，避免空坐标渲染
  if (waterCoords) {
    try {
      businessLayerManager.register(WATER_SURFACE_ID, {
        label: '水面',
        layerType: 'waterSurface',
        data: { coordinates: waterCoords, height: floodStore.waterLevel },
        options: { color: LAYER_FILL_WATER },
        visible: true,
      })
    } catch (e) {
      // 单图层注册失败（如 Cesium viewer 复用未就绪）不中断后续注册，避免其余图层连带缺失
      logger.warn('[FloodAnalysisPage] 水面图层注册失败（已跳过该层）:', e)
    }
  }

  // 淹没范围/受影响设施图层默认不注册：滑块未操作时面板无开关、地图不渲染；
  // 首次操作滑块由 renderFloodAreas/renderAffectedFacilities 的 has() 兜底自动注册，之后固定显示

  // 地形山影（DEM）：v5 起按需求改为**随底图默认加载的基础能力**——
  // 默认可见、面板不列出（listed:false）、不可关闭（locked:true）。
  // 但仍走 businessLayerManager 注册：图层状态只有一个事实源（04 清单 A4），
  // 引擎切换时的重绘、卸载时的清理也都由 BLM 统一收口，不另开旁路。
  // 引擎为 2D 时无此能力（Cesium 独占定义），注册会被 adapter 的能力守卫跳过。
  try {
    businessLayerManager.register(DEM_HILLSHADE_LAYER_ID, {
      label: '地形山影',
      layerType: 'geotiff',
      data: '/static/dem/dem_hillshade.tif',
      options: { opacity: 0.7 },
      // 默认开：与底图一同加载，不需要用户操作
      visible: true,
      // 不进图层面板：基础能力不该占面板格子，也不该给用户"能关"的错觉
      listed: false,
      // 不可关：它是底图固有部分，关掉只会让地图变半成品
      locked: true,
    })
  } catch (e) {
    // 单图层注册失败不中断（与水面同款容错）
    logger.warn('[FloodAnalysisPage] 地形山影图层注册失败（已跳过该层）:', e)
  }
}

// 渲染器就绪/引擎变化时维护业务图层：水面/DEM 为 Cesium 独占——3D 注册、2D 移除入口；
// 注册标志随引擎复位，2D→3D 切换后重新注册（不再一次性锁死）
watch(
  () => mapStore.currentRenderer,
  (renderer) => {
    if (renderer) {
      void nextTick(() => {
        // 能力守卫驱动（isWater3DCapable），业务页不再 getType() 判断引擎
        if (isWater3DCapable(renderer)) {
          void registerFloodLayers(getFloodSignal())
        } else {
          removeCesiumOnlyLayers()
        }
      })
    }
  },
  { immediate: true }
)

/** 跳个人中心保存快照，离开其它路由清态（快照守卫公共化，语义与站点/预测页一致） */
useProfileSnapshot({
  save: saveCurrentState,
  clear: () => floodStore.clearState(),
})

function saveCurrentState() {
  floodStore.saveState({
    waterLevel: floodStore.waterLevel,
    floodStatistics: floodStore.floodStatistics,
    floodFeatures: floodStore.floodFeatures,
    floodRiskLevel: floodStore.floodRiskLevel,
    affectedFacilities: floodStore.affectedFacilities,
    totalLoss: floodStore.totalLoss,
  })
}

/** 挂载时恢复保存的状态 */
onMounted(async () => {
  // v4-S3：把渲染回调注入面板——面板发完请求后调它们写 store + 上图。
  // 🔴 必须在面板 mount 之后注册（ref 此时才可用），故放本页 onMounted 最前。
  //    顺序讲究：先注册回调，再（可能地）触发首屏，避免首屏结果回来时回调还是空的。
  waterPanelRef.value?.registerRenderers({
    analysis: applyFloodAnalysis,
    impact: applyImpactAssessment,
    waterSurface: updateWaterSurfaceHeight,
  })

  // 恢复路径整体兜底——renderFloodAreas/renderAffectedFacilities 经 BLM updateData
  // 对未注册图层 throw（layerAdapters 数据守卫），async 钩子无 catch 会成 unhandledrejection
  try {
    const savedState = floodStore.consumeState()
    if (savedState) {
      // v4-S3：分析请求已随请求迁到面板。这里只置 stateRestored 抑制面板的自动分析
      // 🔴 必须在 `floodStore.setWaterLevel` **之前**置位：面板会 watch waterLevel，
      //    若先写水位再置标志，面板可能已经因水位变化跑了一轮（恢复场景白跑一次请求）。
      stateRestored.value = true

      floodStore.setWaterLevel(savedState.waterLevel)

      if (savedState.floodStatistics) {
        floodStore.startFloodAnalysis(
          savedState.floodStatistics,
          savedState.floodFeatures,
          savedState.floodRiskLevel
        )
      }

      if (savedState.affectedFacilities) {
        floodStore.setPortImpactResult(savedState.affectedFacilities, savedState.totalLoss ?? 0)
      }

      // 等待图层注册完成
      await nextTick()

      // 主动渲染图层（快照里的数据直接上图，不发请求）
      if (savedState.floodFeatures && savedState.floodFeatures.length > 0) {
        renderFloodAreas(savedState.floodFeatures)
      }
      if (savedState.affectedFacilities && savedState.affectedFacilities.length > 0) {
        renderAffectedFacilities(savedState.affectedFacilities)
      }

      stateRestored.value = false
      return
    }
  } catch (e) {
    logger.warn('[FloodAnalysisPage] 状态恢复失败（图层未就绪等），已跳过恢复:', e)
    stateRestored.value = false
  }

  // 无快照：面板 onMounted 已自行跑过首屏（水位 0），无需页面再触发。
  // 水位为 0 时后端返回空淹没范围，属"合法空结果"，面板不会跳过。
})

// 滑块联动设计：未操作滑块则不注册淹没/设施图层（面板无开关、地图不渲染）；
// 首次操作后自动注册并固定显示；刷新/离开路由回到默认
//
// ── v4-S3：请求归属收进 WaterLevelProfilePanel ───────────────────────────────
// 本页**不再发起任何淹没/影响请求**。滑块（在面板里）变化后直接调 composable 取数，
// 拿到结果通过下方注册的渲染回调写 store + 上图。
//
// 🔴 关键：请**不要**在本页重新引入请求。请求归面板的理由与 forecast 一致——
//    面板拖进 dock 后页面会被卸载，请求若长在页面里，"后台跑"就无从谈起。
//    同时 flood 的滑块拖动走**直连**（不走任务队列），理由见 useFloodRequest 头注释。

/**
 * 渲染回调注册表（与 forecast 页同款注入模式）。
 *
 * 🔴 为什么不让面板自己调渲染？图层 manager 与 store 写入口都在页面的 scope 里，
 *    面板自己 new 一份 composable 只会写进另一份闭包，地图永远不动。
 */
interface FloodRenderers {
  /** 淹没范围 + 统计 → store + 图层 */
  analysis?: (payload: {
    features: FloodFeature[]
    statistics: FloodStatistics
    riskLevel: string
    actualWaterLevel?: number
  }) => void
  /** 受影响设施 → store + 图层 */
  impact?: (payload: { affectedFacilities: AffectedFacility[]; totalLoss: number }) => void
  /** 请求真正落地后抬升水面高度。
   *
   * 与下方 `watch(floodStore.waterLevel)` 的分工：那个 watch 是**乐观预览**
   * （滑块一动就跟着抬，手感即时），本回调是**权威落定**（后端实际命中档位，
   * 水位可能被向上取档而 ≠ 滑块值）。两者都跑，后者覆盖前者。
   */
  waterSurface?: (actualWaterLevel: number) => void
}

/** 面板实例（注入渲染回调；请求能力自持于面板内部） */
type FloodPanelExposed = {
  registerRenderers: (r: FloodRenderers) => void
  /** 拖入 dock：以当前水位提交后台任务并置停靠态，返回是否成功 */
  dockToTask: () => Promise<boolean>
}
const waterPanelRef = ref<FloodPanelExposed | null>(null)

/** 页面已卸载标志：丢弃迟到响应，防止离开后图层复活 */
let unmounted = false

function shouldRenderForCurrentRoute() {
  const actual = mapStore.currentRenderer?.getType?.()
  if (!actual) return false
  // 2026-09-10（阶段 4）：原「calculate 模式 2D/3D 均可渲染」分支已随双模式移除——
  // 该分支在生产恒为 false（dataSource 硬编码 'fetch'），删除后行为与原生产一致（3D-only）
  const expected = route.meta?.engine
  return expected === actual
}

/** 渲染淹没问题（v4-S3：请求已由面板发起，本函数只负责写 store + 上图） */
function applyFloodAnalysis(payload: {
  features: FloodFeature[]
  statistics: FloodStatistics
  riskLevel: string
  actualWaterLevel?: number
}): void {
  // 如果当前路由不再是 3D，丢弃过期响应防止污染 2D 渲染器
  if (!shouldRenderForCurrentRoute()) return
  // 页面已卸载则丢弃响应，防止离开后图层复活
  if (unmounted) return

  const { statistics, features, riskLevel, actualWaterLevel } = payload

  logger.debug('[Flood] 更新淹没分析数据:', {
    statistics,
    features: features.length,
    riskLevel,
    actualWaterLevel,
  })

  floodStore.startFloodAnalysis(statistics, features, riskLevel)

  // 在地图上渲染淹没范围
  renderFloodAreas(features)

  // 后端实际命中档位可能与请求水位不同（向上取档）——以其为准抬升水面，
  // 否则水面会停在请求值上，与淹没多边形自相矛盾。
  if (typeof actualWaterLevel === 'number') {
    updateWaterSurfaceHeight(actualWaterLevel)
  }
}

/** 渲染影响评估（v4-S3：同上，只做写 store + 上图） */
function applyImpactAssessment(payload: {
  affectedFacilities: AffectedFacility[]
  totalLoss: number
}): void {
  if (!shouldRenderForCurrentRoute()) return
  if (unmounted) return

  const { affectedFacilities, totalLoss } = payload

  logger.debug('[Flood] 更新影响评估数据:', { facilities: affectedFacilities.length, totalLoss })

  floodStore.setPortImpactResult(affectedFacilities, totalLoss)

  // 在地图上渲染受影响设施
  renderAffectedFacilities(affectedFacilities)
}

function renderFloodAreas(features: FloodFeature[]) {
  // 空数组也继续更新（清空图层）：水位回落至无淹没档位时，残留旧多边形会与当前水位不符
  if (!features) return

  // 检查图层是否已注册，若未注册则先注册
  if (!businessLayerManager.has(FLOOD_LAYER_ID)) {
    businessLayerManager.register(FLOOD_LAYER_ID, {
      label: '淹没范围',
      layerType: 'geojson',
      data: null,
      options: {},
      visible: true,
    })
  }

  const riskLevel = floodStore.floodRiskLevel
  const fillColor = getRiskFillColor(riskLevel)
  const strokeColor = getRiskColor(riskLevel)

  const geojson = {
    type: 'FeatureCollection',
    features: features,
  }

  businessLayerManager.updateData(FLOOD_LAYER_ID, {
    data: geojson,
    options: {
      fillColor,
      strokeColor,
      strokeWidth: 2,
      featureType: 'flood-area',
    },
  })
}

function renderAffectedFacilities(facilities: AffectedFacility[]) {
  // 空数组也继续更新（清空图层）：水位回落无设施被淹时，残留旧 POI 会误导（用户实测问题）
  if (!facilities) return

  // 检查图层是否已注册，若未注册则先注册
  if (!businessLayerManager.has(FACILITY_LAYER_ID)) {
    businessLayerManager.register(FACILITY_LAYER_ID, {
      label: '受影响设施',
      layerType: 'points',
      data: null,
      options: {},
      visible: true,
    })
  }

  // points 图层契约要求 data 为点数组：传 FeatureCollection 会被透传为点数组而报错，故映射为点数组
  // P0-1：无效坐标过滤而非 `|| 0` 伪装 (0,0) 哨兵（crs.ts 自注"不再回退哨兵"）
  const points = facilities
    .filter((f) => Number.isFinite(Number(f.lng)) && Number.isFinite(Number(f.lat)))
    .map((f) => ({
      lng: f.lng,
      lat: f.lat,
      id: f.id,
      name: f.name,
      type: f.type,
      port: f.port,
      loss: f.loss,
      damageRate: f.damageRate,
    }))

  businessLayerManager.updateData(FACILITY_LAYER_ID, {
    data: points,
    options: {
      // 引用调色板常量（同值见 FLOOD_RISK_COLORS['高风险'].stroke），杜绝第二份字面量漂移
      markerColor: FLOOD_RISK_COLORS['高风险'].stroke,
      markerSize: 10,
      featureType: FACILITY_FEATURE_TYPE,
    },
  })
}

function getRiskColor(riskLevel: string) {
  return (FLOOD_RISK_COLORS[riskLevel] ?? FLOOD_RISK_DEFAULT).stroke
}

function getRiskFillColor(riskLevel: string) {
  return (FLOOD_RISK_COLORS[riskLevel] ?? FLOOD_RISK_DEFAULT).fill
}

/**
 * 立即抬升水面到指定高度（不做防抖）。
 *
 * 两条调用路径共用：
 *   · 请求落定 → `renderers.waterSurface` → 本函数（权威值，立即可见）
 *   · 滑块拖动 → 下方 watch 防抖 → 本函数（乐观预览，等 `FLOOD_ANALYSIS_DELAY` 合并）
 *
 * 🔴 前置条件：图层已注册 **且** 水域坐标已缓存。前者保证水面在 3D 引擎里存在，
 *    后者保证有几何可抬——两者缺一都直接返回（不注册新图层，那是 `registerFloodLayers` 的事）。
 */
function updateWaterSurfaceHeight(level: number): void {
  if (unmounted) return
  if (!businessLayerManager.has(WATER_SURFACE_ID)) return
  if (!cachedWaterAreaCoords) return

  businessLayerManager.updateData(WATER_SURFACE_ID, {
    data: { coordinates: cachedWaterAreaCoords, height: level },
  })
}

// 水位变化防抖后更新水面高度（与请求同节奏），滑块拖动期间合并为一次几何更新。
// 🔴 这是**几何**更新（水面格网抬高），不是请求——水面坐标已缓存，无需重新取数。
//    请求侧的水位联动在面板里（见 useFloodRequest），此处只跟 store 值走。
watch(
  () => floodStore.waterLevel,
  (newLevel) => {
    if (waterSurfaceTimer) clearTimeout(waterSurfaceTimer)
    waterSurfaceTimer = setTimeout(() => {
      updateWaterSurfaceHeight(newLevel)
    }, FLOOD_ANALYSIS_DELAY)
  }
)

onUnmounted(() => {
  unmounted = true

  // ═══ v4-S3 逐条判定：什么该清、什么绝不能清 ═══
  //
  // ✅ 可清（UI/渲染状态）：
  //   · waterSurfaceTimer —— 本页自己的几何防抖；卸载后写图层无意义
  //   · 四个业务图层 —— 图层是"当前引擎上的画"，引擎单例复用，不清会泄漏到别的页
  //   · floodLayersRegistered / cachedWaterAreaCoords —— 注册与缓存标志随组件复位
  //   · resetSubStates —— 对齐既有口径：水位/影响复位，分析数据留在 store 供往返恢复
  //   · 面板自己会 abort 它的直连请求（面板 onUnmounted 负责，见 useFloodRequest.abortInflight）
  //
  // 🔴 不可清（任务状态，属于 taskStore）：
  //   · 后端洪涝任务 —— 严禁在此调 taskStore.cancel()！用户把面板拖进 dock
  //     正是为了"页面不管了它还得跑"；这里取消等于把保活功能当场废掉。
  //     页面自己的 signal（createFloodSignal）只覆盖水面/DEM 加载，不覆盖分析请求。
  if (waterSurfaceTimer) {
    clearTimeout(waterSurfaceTimer)
    waterSurfaceTimer = null
  }

  // Manager 统一清理业务图层
  businessLayerManager.remove(WATER_SURFACE_ID)
  businessLayerManager.remove(FLOOD_LAYER_ID)
  businessLayerManager.remove(FACILITY_LAYER_ID)
  // 地形山影虽不进面板，仍是本页注册的业务图层，一并移除（BLM 统一收口）
  businessLayerManager.remove(DEM_HILLSHADE_LAYER_ID)

  // 重置注册标志
  floodLayersRegistered = false

  // 2026-09-10（阶段 4）：原 floodAdapter.clearCache()（calculate 档位缓存）已随
  // 双模式移除；水域坐标缓存仍在
  cachedWaterAreaCoords = null

  // 卸载时仅复位子状态（水位/影响评估）——分析数据保留在 store 活状态，
  // 供"跳 /profile → 返回"时 consumeState 恢复（2026-08-11 修复：原同时调
  // resetFloodAnalysis() 清空分析数据，导致往返恢复失效）；
  // 离开非 /profile 路由由 onBeforeRouteLeave 的 clearState() 统一清空。
  floodStore.resetSubStates()
})
</script>

<template>
  <div class="flood-analysis-page">
    <AppLayout>
      <template #left>
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <FloodAnalysisReportPanel />
        </GCSPanel>

        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="5.5">
          <AffectedFacilityListPanel />
        </GCSPanel>
      </template>

      <template #right>
        <!-- v4：可拖拽主控制面板槽（水位滑块即本页主控制面板） -->
        <TaskPanelSlot
          :w="4"
          :h="4"
          anchor="top-right"
          :offset-x="0"
          :offset-y="1.25"
          label="水位控制"
          :task-slot="floodTaskSlot"
          @dock="handleDock"
        >
          <WaterLevelProfilePanel ref="waterPanelRef" :state-restored="stateRestored" />
        </TaskPanelSlot>

        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel
            :layer-order="[
              'base-image',
              'base-vector',
              'boundary',
              'ports',
              'flood-water-surface',
              FLOOD_LAYER_ID,
              FACILITY_LAYER_ID,
              DEM_HILLSHADE_LAYER_ID,
            ]"
          />
        </GCSPanel>
      </template>
    </AppLayout>
  </div>
</template>

<style scoped>
.flood-analysis-page {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  pointer-events: none;
}

.flood-analysis-page :deep(.GCS-panel) {
  pointer-events: auto;
}

.panel-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  /* S7 P1-2：硬编码白 rgba → 容器/token 文字色（明暗主题均可正确切换） */
  background: var(--GCS-bg-container);
  border: 1px dashed var(--GCS-border-default);
  border-radius: 8px;
  color: var(--GCS-text-secondary);
}

.placeholder-title {
  font-size: var(--GCS-font-size-lg); /* 面板标题字号归档 */
  font-weight: 500;
  margin-bottom: 8px;
}

.placeholder-desc {
  font-size: 13px;
  opacity: 0.7;
}

/* Cesium 3D路由禁用backdrop-filter，避免WebGL性能问题 */
.flood-analysis-page :deep(.GCS-panel) {
  backdrop-filter: none !important;
  background: var(--GCS-bg-panel-translucent) !important;
}
</style>
