<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'

import { businessModules, runBusinessLogoutReset } from '@/business'
import { BusinessLayerManager, layerFailureMessage } from '@/core'
import { BUSINESS_LAYER_MANAGER_KEY } from '@/core'
import { registerNavItems } from '@/core'
import {
  isRoutePreparing,
  notifyRouteReadiness,
  notifyTaskIndicator,
  registerRouteReadiness,
  registerTaskIndicator,
  TaskDropZone,
  TaskResultChip,
} from '@/core'
import { useMapControls } from '@/core'
import {
  EDITING_PLAN_KEY,
  RESTORE_PLAN_DATA_KEY,
  UNIFIED_MAP_KEY,
  type UnifiedMapExposed,
} from '@/core'
import { preloadCesium, UnifiedMap } from '@/core'
import { taskResultToIR, useLayerIRLayer, type LayerIR } from '@/core/map/ir/LayerIR'
import {
  ErrorBoundary,
  GCSModal,
  GCSToast,
  initAuthStorageListener,
  removeAuthStorageListener,
  showWarning,
  useAuth,
  useGlobalPanelDragActive,
  useWaitForRenderer,
  warmupAfterFirstFrame,
} from '@/shared'
import { logger } from '@/shared'
import { preloadBusinessAssets } from '@/business/preload'
import { useMapStore, useTaskStore } from '@/stores'
import type { TypeSetting } from '@/types/facility'
import type { Plan } from '@/types/plan'

const route = useRoute()
const router = useRouter()
// authUser 供 watch 驱动登出/多标签页登出时的 store 重置
const { restoreAuth, user: authUser } = useAuth()
const { zoomToRegion, stopBreathing } = useMapControls()
const mapStore = useMapStore()
const taskStore = useTaskStore()

const unifiedMapRef = ref<UnifiedMapExposed | null>(null)
const restorePlanData = ref<Record<string, TypeSetting> | null>(null)
const editingPlan = ref<Plan | null>(null)

provide(RESTORE_PLAN_DATA_KEY, restorePlanData)
provide(EDITING_PLAN_KEY, editingPlan)
provide(UNIFIED_MAP_KEY, unifiedMapRef)

// 提供 BusinessLayerManager — 必须在 App.vue 而非 UnifiedMap，
// 因为 RouterView 下的业务组件是 UnifiedMap 的兄弟节点，不是子节点
const businessLayerManager = new BusinessLayerManager(mapStore)
provide(BUSINESS_LAYER_MANAGER_KEY, businessLayerManager)

// 图层渲染失败由 manager 回调上报，UI 展示方式由上层决定。
// 文案由 layerFailureMessage 按 payload.retryable 生成——只在"面板确有该条目且数据在手"
// 时才承诺"点击面板开关重试"，否则给刷新页面的出路（旧文案恒承诺"再点击一次重试"，
// 而对未登记图层（listed=false）根本没有可点的按钮）
businessLayerManager.setErrorHandler((payload) => {
  showWarning(layerFailureMessage(payload))
})

// 登出/多标签页登出（authUser 变 null）时统一重置各业务 store
function resetStores(): void {
  try {
    // 业务层（Forecast/Flood/Route 等）：重置声明在 business/manifest 各模块上，
    // 新增业务模块的新状态重置只需在清单补 reset，无需改这里
    runBusinessLogoutReset()
    // 常驻层（App 级，不属于任何业务模块）：重置地图业务交互状态
    //（z151：lastAnalysisResult 死状态已删，勿再引用会话持久化口径）
    useMapStore().resetMapState()
    // 🔴 taskStore 同为常驻层，必须在清单里：04-C2 的依据原文已点名过它一次
    //（漏清 = 切账号后上一账号的任务槽与结果仍在前端）。
    // clearAll 会停链式轮询定时器并释放 controller；在等的 waitForResult
    // 因"槽位消失"自行 resolve(null)，不会留悬空 Promise。
    taskStore.clearAll()
    // 常驻层目录对账：resetMapState 会连 boundary/ports 这两个 App 级常驻层的目录条目
    // 一起删掉，但 BLM registry 与渲染器实例都还在（图层照常显示）——不同步重建的话，
    // 图层控制面板按钮会缺失直到下次引擎切换/刷新（registry 为目录唯一权威源，显式对账）
    businessLayerManager.reconcileWithRenderer()
  } catch {
    // store 未激活等异常不阻断登出
  }
}
watch(
  () => authUser.value,
  (u) => {
    if (!u) resetStores()
  }
)

function handleRequireLogin() {
  void router.push('/profile')
}

// 注册底部导航项：core/layout 不引 business，由根入口从 manifest 注入业务导航项（分层铁律）
registerNavItems([
  { type: 'home', label: '首页', icon: '⌂', path: '/', disabled: false },
  ...businessModules.map((m) => ({
    type: 'business' as const,
    label: m.navLabel,
    icon: m.navIcon,
    path: m.path,
    disabled: !!m.navDisabled,
  })),
  { type: 'profile', label: '个人中心', icon: '👤', path: '/profile', disabled: false },
])

// ===== v4 任务停靠体系（S5/S6）=====
// core/layout 不引 stores（铁律 L3）：任务指示态由根入口注入取值函数，
// core 侧（NavButton 进度环）只调用函数、不认数据来源 —— 与 navConfig 同款解法。
registerTaskIndicator((routePath) => {
  const slot = taskStore.getSlot(routePath)
  if (!slot) {
    return { active: false, occupied: false, status: null, progress: 0 }
  }
  return {
    active: slot.status === 'pending' || slot.status === 'running' || slot.status === 'retrying',
    occupied: true,
    status: slot.status,
    progress: slot.progress,
  }
})

// 槽位变化 ⇒ 通知 core 重算进度环（core 不订阅 Pinia，靠计数驱动）
watch(
  () => taskStore.slots,
  () => notifyTaskIndicator(),
  { deep: true }
)

// ===== 3D 路由「准备中」→ 同一个导航进度环（Cesium ②，2026-10-02 用户定）=====
// 不新增 UI 形态；判据由 meta.engine 派生 ⇒ **所有 3D 路由都适用**（新增 3D 模块自动纳入，
// 不写死路由清单）。就绪即熄灭；切换失败时 mapStore.mapType 被回滚 ⇒ 判据立刻 false，
// 环不会永远呼吸（详见 core/layout/routeReadiness.ts 的 isRoutePreparing 注释）。
const preparingRoutePath = computed<string | null>(() => {
  const rendererType = mapStore.currentRenderer?.getType?.() ?? null
  return isRoutePreparing(route.meta?.engine, rendererType, mapStore.mapType) ? route.path : null
})
registerRouteReadiness((routePath) => ({ preparing: routePath === preparingRoutePath.value }))
watch(preparingRoutePath, () => notifyRouteReadiness())

/**
 * 投递区悬停高亮由面板侧判定（usePanelDrag.overZone 给面板自身加 is-over-zone），
 * 投递区自身不做第二份拖拽状态 —— 双份状态会与面板判定竞态。
 * 🔴 但「是否有人在拖」必须是全局态：投递区常态完全透明（不吃指针事件），
 *    拖拽期需要显形提示，否则用户不知道能放哪里。由 shared 的模块级单例告知。
 */
const panelDragActive = useGlobalPanelDragActive()

// ===== v4-S8 系统 C：已完成任务结果「拖出上图」（数据跨路由，纯渲染不重算）=====
// chip 列表来自 taskStore 终态槽位中「可渲染域」的结果（core/map/ir 做结构判定）；
// toggle 走 useLayerIRLayer（useOwnedLayers→BLM 通道）：引擎切换后由 reapplyAll 自动重现。
// 🔴 单实例：has（owner 册判重）与 toggle 必须同册，两份实例会互相看不见。
const layerIR = useLayerIRLayer()

/** 终态且可渲染的任务结果 → chip 视图模型（domain 不支持/结果畸形的不出手柄） */
const resultChips = computed(() => {
  const chips: Array<{ key: string; label: string; color: string; active: boolean; ir: LayerIR }> =
    []
  for (const slot of Object.values(taskStore.slots)) {
    if (!slot || slot.status !== 'done' || !slot.result) continue
    const ir = taskResultToIR(slot)
    if (!ir) continue
    chips.push({
      key: ir.id,
      label: ir.meta.label,
      color: ir.style.strokeColor ?? '#8a93a6',
      active: layerIR.owned.has(ir.id),
      ir,
    })
  }
  return chips
})

function onResultChipToggle(ir: LayerIR): void {
  const action = layerIR.toggleIR(ir)
  logger.debug('[App] 任务结果拖出上图 toggle:', ir.meta.label, action)
}

// 等待渲染器就绪后再执行缩放（公共 composable：500ms×10 有限重试，卸载自动取消）
const waitForRenderer = (callback: () => void) =>
  useWaitForRenderer(() => unifiedMapRef.value?.getRenderer?.() ?? null, callback)

/**
 * 统一处理路由变化与引擎切换：检测 meta.engine 变化区分二者，
 * 避免引擎切换时 watcher 覆盖 importState 设置的相机位置
 */
watch(
  () => ({
    name: route.name,
    engine: route.meta?.engine,
  }),
  (newRoute, oldRoute) => {
    stopBreathing()

    // v4：同步当前路由到 taskStore —— 决定新任务的优先级（当前路由 = high 插队）
    taskStore.setCurrentRoute(route.path)

    // 检测是否是引擎切换场景（engine 发生变化）
    const isEngineSwitch =
      oldRoute?.engine && newRoute.engine && oldRoute.engine !== newRoute.engine

    logger.debug('[App.vue] route watcher triggered:', {
      newName: newRoute.name,
      oldName: oldRoute?.name,
      newEngine: newRoute.engine,
      oldEngine: oldRoute?.engine,
      isEngineSwitch,
    })

    // 更新地图引擎类型
    const engine = newRoute.engine as string
    if (engine && ['2d', '3d'].includes(engine)) {
      mapStore.setMapType(engine as '2d' | '3d')
    }

    // 仅非引擎切换场景执行相机重置（引擎切换时相机由 importState 管理）
    if (!isEngineSwitch) {
      if (newRoute.name === 'Home') {
        waitForRenderer(zoomToRegion)
      }
    } else {
      logger.debug('[App.vue] 引擎切换场景，跳过相机重置（由 importState 管理）')
    }
  },
  { immediate: true }
)

// 引擎切换后旧 renderer 上残留的业务图层需清理（registry 在 App 级持久，页面不会重新 register）。
// 重建统一由 UnifiedMap.initRenderer 尾部的 reapplyAll 负责，此处只清不建，避免重复 create。
// flush:'sync' 关键：reapplyAll 在切换调用栈内同步执行，默认异步 watcher 会晚于它触发，
// 导致图层"先建后删"（2D 不显示）；同步 flush 保证"先清理、后重建"顺序。
watch(
  () => mapStore.currentRenderer,
  (renderer, oldRenderer) => {
    if (!renderer) return
    if (oldRenderer && oldRenderer !== renderer) {
      businessLayerManager.removeAllFromRenderer(oldRenderer)
      businessLayerManager.removeAllFromRenderer(renderer)
    }
  },
  { flush: 'sync' }
)

onMounted(() => {
  void restoreAuth() // 启动时经 /api/auth/me 验证 Cookie Token
  initAuthStorageListener() // 多标签页登录态同步
  // 预热队列（设计约定：首屏之后错峰预热大资源，逐项让路不抢带宽）：
  // ① 首帧后第一个空闲 → Cesium 脚本（5.8MB）——切 3D 秒开。
  //    2026-10-02 改口径：原为「load + 3s」固定延时——那 3s 是拍的，与首屏忙不忙无关，
  //    而 3D 该等的字节一个没提前。现交由浏览器在首帧画完后自己决定何时空闲
  //    （实现见 shared/utils/warmupAfterFirstFrame）。任一项失败静默。
  warmupAfterFirstFrame(preloadCesium)
  // ② 排在 Cesium 之后 → 3D Tiles 瓦片集与内容 GLB。
  //    为什么放队列里而不是首屏拉：3D 挂在懒加载路由（RouteAnalysisPage）上，
  //    不在首屏路径；用户裁定原文「3d又不在首屏加载？这个进预热队列吧」。
  //    实现是**串行**的（不与 Cesium 的 5.8 MB 抢带宽，z130 的教训），
  //    且失败静默——预热只是优化，正式路径自会按需加载。
  warmupAfterFirstFrame(() => void preloadBusinessAssets())
  // 2026-09-10（阶段 4）：原 +6s 的「/flood/online 查 0 档暖机」已删——它只为预热
  // algorithm-service 的 FastAPI load_dem 模块，该服务退役后无对象可预热
})

onUnmounted(() => {
  businessLayerManager.destroy() // 释放图层注册表元数据
  removeAuthStorageListener() // 与 initAuthStorageListener 配对
})
</script>

<template>
  <div class="app-layout">
    <ErrorBoundary>
      <UnifiedMap ref="unifiedMapRef" :map-type="mapStore.mapType" />
    </ErrorBoundary>
    <main class="app-content">
      <ErrorBoundary>
        <RouterView v-slot="{ Component }">
          <component :is="Component" @require-login="handleRequireLogin" />
        </RouterView>
      </ErrorBoundary>
    </main>
    <!-- 全局 GCS 反馈层（统一提示组件，替换 ElMessageBox/ElMessage） -->
    <GCSModal />
    <GCSToast />
    <!-- v4 任务投递区：导航条上方的透明命中区，拖到这里 = 任务转后台（不改 .app-layout 结构，L1）。
         常态完全透明且不吃指针事件；拖拽期显形虚线提示。
         🔴 必须常驻渲染（不做 v-if）：元素不在 DOM 则 elementFromPoint 落空、drop 永不触发 -->
    <TaskDropZone :drag-active="panelDragActive" :drop-active="panelDragActive" />
    <!-- v4-S8 系统 C：已完成任务结果「拖出上图」芯片条（数据跨路由，纯渲染不重算）。
         空态整体不渲染（同 dock 空态口径）；常驻不随路由卸载——跨路由上图是它的存在意义。
         点击/拖拽松开同义：上图⇄撤下 toggle（去重键 = taskId+kind，永不重复） -->
    <div v-if="resultChips.length" class="task-result-strip">
      <TaskResultChip
        v-for="chip in resultChips"
        :key="chip.key"
        :label="chip.label"
        :color="chip.color"
        :active="chip.active"
        @toggle="onResultChipToggle(chip.ir)"
      />
    </div>
  </div>
</template>

<style scoped>
.app-layout {
  position: relative;
  height: 100vh;
}

.app-content {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  pointer-events: none;
  z-index: var(--GCS-z-layout); /* 壳层档（原散落 50） */
}

/* 不能设 .app-content > * { pointer-events: auto }：会让业务页面成为全屏事件拦截层，
   阻挡地图容器鼠标事件（拖拽/缩放/旋转失效）；由各业务页面自行控制，AppLayout 再恢复 */

/* v4-S8 结果芯片条：导航+投递区上方的左下角浮层（新增层，不改既有布局，L1） */
.task-result-strip {
  position: absolute;
  left: 12px;
  bottom: 96px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  z-index: var(--GCS-z-nav);
  pointer-events: auto;
}
</style>
