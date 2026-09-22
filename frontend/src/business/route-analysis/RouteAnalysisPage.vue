<script setup lang="ts">
/**
 * 航线分析业务页（Cesium 引擎驱动）：
 * 控制面板（右上图层控制上方 4×4）选点 → 逐段调 /route/path（Nest + pgRouting）→
 * 多段路径线 + 端点标记图层；左栏为结果摘要面板。
 * 选点双入口：POI 搜索（Nest /site-analysis/pois）或地图点击（限钦北防三市，见 RouteControlPanel）。
 * 引擎固定 3D（Cesium）：由路由 meta.engine='3d' 经 App 路由守卫统一驱动，本页不再自行切换/还原，
 * 与浸没分析一致——同为 3D 的路由互切时 UnifiedMap 直接复用同一 Viewer，不卸载、不重建上下文。
 * 路径线/端点图层走 BLM 注册（双引擎通用，本页不再暴露 OL 链路）。
 */
import { computed, onUnmounted, ref, watch } from 'vue'

import {
  AppLayout,
  deriveGroupTileset,
  GCSPanel,
  isImageOverlayCapable,
  isTiles3DCapable,
  LayerControlPanel,
  tallyGroups,
  toDataUri,
  useBusinessLayers,
  type TilesetJson,
} from '@/core'
import { logger, showToast } from '@/shared'
import { useMapStore, useTaskStore } from '@/stores'
import type { RoutePathResult } from '@/types'
import type { TaskSlot } from '@/types/task'

import RouteControlPanel from './components/RouteControlPanel.vue'
import { ROUTE_ENDPOINT_LAYER_ID, ROUTE_PATH_LAYER_ID } from './composables/useRouteLayer'
import {
  PINGLU_GROUPS,
  PINGLU_IMAGERY_INDEX_URL,
  PINGLU_IMAGERY_LAYER_PREFIX,
  PINGLU_TILESET_URL,
  pingluLayerId,
  type PingluImageryIndex,
} from './constants/pingluTiles'

/*
 * 平陆运河 3D Tiles 图层（v5：由单个 `pinglu-hubs` 总开关拆成按分组多个图层）。
 *
 * 瓦片集是一棵树，整包加载时用户只能全开全关；「只看青年枢纽」「只看桥」是实际诉求，
 * 故按分组派生后各自成层。派生机制在 core（通用、零业务语义），本页的分组定义在
 * ./constants/pingluTiles（业务语义收口于 business 层）。
 */

/** 影像块图层 id（异步注册，供图层面板 layer-order 与引擎切换时清理） */
const imageryLayerIds = ref<string[]>([])
/** 影像索引加载与注册均已完成（防重复注册） */
let imageryRegistered = false

/** 当前渲染器是否支持影像块（局部变量收窄，避免属性访问在能力检查里失去 narrowing） */
function canOverlayImagery(): boolean {
  const r = mapStore.currentRenderer
  return !!r && isImageOverlayCapable(r)
}

/**
 * 注册三个枢纽的离线影像块。索引拉取是异步的，且期间渲染器可能被切换，
 * 故注册前再验一次能力，避免把图层登记到已换成 2D 的渲染器上。
 */
async function registerImageryLayers(): Promise<void> {
  if (imageryRegistered) return
  if (!canOverlayImagery()) return
  try {
    const res = await fetch(PINGLU_IMAGERY_INDEX_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const index = (await res.json()) as PingluImageryIndex
    if (!canOverlayImagery()) return
    for (const t of index.tiles) {
      const id = PINGLU_IMAGERY_LAYER_PREFIX + t.name
      businessLayerManager.register(id, {
        label: `${t.label}影像`,
        layerType: 'imageOverlay',
        data: {
          url: `/static/pinglu/imagery/${t.file}`,
          bbox: t.bbox,
          size: [t.width, t.height],
        },
        // 默认开：该图与 3D Tiles 同源同坐标系，用于对照核验模型落位；不需要时在面板关掉
        visible: true,
      })
      imageryLayerIds.value = [...imageryLayerIds.value, id]
    }
    imageryRegistered = true
  } catch (e) {
    logger.warn('[RouteAnalysis] 离线影像索引加载失败（已跳过影像图层）:', e)
  }
}

const mapStore = useMapStore()
const taskStore = useTaskStore()
const { manager: businessLayerManager } = useBusinessLayers()

/** v4：本页路由标识（taskStore 按 route 分槽的 key；与 manifest.path 一致） */
const ROUTE_PATH = '/route-analysis'

/** v4：本路由的任务槽（供面板判定拖拽锁定态） */
const routeTaskSlot = computed<TaskSlot | null>(() => taskStore.getSlot(ROUTE_PATH))

/**
 * v4：面板被拖入投递区 ⇒ 该路由的任务「让位排队」。
 *
 * ## 语义（2026-09-19 用户澄清后定稿）
 *
 * 拖拽**不改变面板的显示**（面板始终在原位），它改变的是任务优先级：
 * 该任务从"当前路由任务（high，插队）"降为"后台任务（normal，排队）"。
 * 而优先级由 `taskStore.submit` 的 `route === currentRoute ? 'high' : 'normal'`
 * 自动决定 —— 所以切走后它自然降级、切回来自然升级，**无需任何取回动作**。
 *
 * `setDocked(true)` 只做两件事：① 记录"用户主动让位过"这一审计信息；
 * ② 作为导航环「停靠中保留」的判据。它**不驱动面板显隐**。
 *
 * ## 无槽时为什么给提示而不是静默
 *
 * 用户拖拽的意图是"丢到后台"，若什么都不发生会以为是 bug。
 * 明确告知"先点开始查询"才是诚实反馈。
 */
function handleDock(): void {
  const slot = routeTaskSlot.value
  if (!slot) {
    showToast('请先点击「开始查询」，之后即可把面板拖到后台运行', 'warning')
    return
  }
  taskStore.setDocked(ROUTE_PATH, true)
}

/** 查询摘要（panel emit 汇聚；null = 尚无结果） */
const summary = ref<{
  totalKm: number
  totalMin: number
  segCount: number
  totalWithSnapKm: number
} | null>(null)

function handleQueryResult(payload: { segments: RoutePathResult[]; pointCount: number }): void {
  const { segments, pointCount } = payload
  const netM = segments.reduce((s, seg) => s + seg.distanceM, 0)
  const snapM = segments.reduce((s, seg) => s + seg.snapDistanceM.from + seg.snapDistanceM.to, 0)
  summary.value = {
    // 主行只合计路网里程；接驳单独透出（多段时接驳含段间吸附往返，不与路网里程混算）
    totalKm: netM / 1000,
    totalMin: segments.reduce((s, seg) => s + seg.durationMin, 0),
    segCount: segments.length,
    totalWithSnapKm: (netM + snapM) / 1000,
  }
  logger.debug(`[RouteAnalysis] 查询完成: ${segments.length} 段 / ${pointCount} 点`)
}

function handleCleared(): void {
  summary.value = null
}

// ---- 地图点击 → 面板选点（渲染器 click 事件；命中要素或空白区均回传坐标） ----

const panelRef = ref<InstanceType<typeof RouteControlPanel> | null>(null)

function handleRendererClick(event: CustomEvent<{ coordinate: [number, number] | null }>): void {
  const coordinate = event.detail?.coordinate
  if (!coordinate || !Array.isArray(coordinate) || coordinate.length < 2) return
  const lng = Number(coordinate[0])
  const lat = Number(coordinate[1])
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
  void panelRef?.value?.handleMapPick(lng, lat)
}

// 拾取监听跟随渲染器实例全生命周期（onMounted 一次性注册有两个丢失窗口：
// ①渲染器异步初始化晚于挂载时 getRenderer() 为 null 静默 return；
// ②引擎切换重建渲染器后旧监听随旧实例销毁、新实例无监听——拾取永久失效。
// watch mapStore.currentRenderer 同时覆盖初次就绪与切换重建，immediate 兜挂载前就绪）
//
// ⚠️ 退出时必须解绑（2026-09-11 补）：渲染器是**单例复用**（mapStore.currentRenderer 跨页面
// 存活），若不摘，离页后该 renderer 仍持有本组件的 handleRendererClick 闭包 ⇒
// ①组件实例无法 GC（闭包捕获 panelRef 等）；②在别的业务页点地图会触发本页已卸载的回调。
// 与 CesiumRenderer 的 webglcontextlost / camera.changed 同一类泄漏模式（add 无 remove）。
const stopRendererWatch = watch(
  () => mapStore.currentRenderer,
  (renderer, old) => {
    old?.off?.('click', handleRendererClick)
    renderer?.on?.('click', handleRendererClick)
  },
  { immediate: true }
)

// ---- 平陆运河 3D Tiles 图层（3D Only，按分组拆开） ----
// 与浸没分析的水面/DEM 同款：能力守卫驱动（isTiles3DCapable），业务页不做 getType() 引擎判断。
// 瓦片定位完全由 tileset.json 自带 transform 决定，前端只负责挂载与显隐。
//
// v5：整包 → 5 个分组。派生 tileset 是异步的（要先取一次完整 tileset.json 当模板），
// 故注册整体放进 async 函数，且中途渲染器可能被切走 ⇒ 每步前后都重验能力。
let pingluRegistered = false
/** 已注册的分组图层 id（供切引擎时成组清理） */
const pingluLayerIds = ref<string[]>([])

async function registerPingluGroups(): Promise<void> {
  if (pingluRegistered) return
  const renderer = mapStore.currentRenderer
  if (!renderer || !isTiles3DCapable(renderer)) return
  try {
    // 取一次完整 tileset 作模板（派生只裁子树，不重新计算任何变换）
    const res = await fetch(PINGLU_TILESET_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const template = (await res.json()) as TilesetJson

    // 异步期间渲染器可能被切走（切 2D / 换实例）——注册前重验，避免登记到失效渲染器上
    if (mapStore.currentRenderer !== renderer || !isTiles3DCapable(renderer)) return

    const { counts, unassigned } = tallyGroups(template, PINGLU_GROUPS)
    if (unassigned.length) {
      // 新增瓦片未归属任何分组 ⇒ 界面上不可见。不抛错（不影响其余分组），但必须留痕
      logger.warn('[RouteAnalysis] 3D Tiles 存在未归属分组的内容，将不会在图层中显示:', unassigned)
    }

    const ids: string[] = []
    for (const group of PINGLU_GROUPS) {
      const derived = deriveGroupTileset(template, group, PINGLU_TILESET_URL)
      if (!derived) {
        logger.warn(`[RouteAnalysis] 3D Tiles 分组「${group.label}」无命中内容，已跳过`)
        continue
      }
      const id = pingluLayerId(group.id)
      try {
        businessLayerManager.register(id, {
          label: `平陆运河 · ${group.label}`,
          layerType: '3dtiles',
          // Data URI：派生结果含绝对 uri，Cesium 的 isDataUri 分支 basePath 为空也不影响
          data: { url: toDataUri(derived), maximumScreenSpaceError: 16 },
          // 默认开：与改造前「一个总开关全开」的行为一致，避免用户以为模型消失了
          visible: true,
        })
        ids.push(id)
        logger.debug(`[RouteAnalysis] 3D Tiles 分组已注册: ${id}（${counts[group.id] ?? 0} 块）`)
      } catch (e) {
        // 单分组注册失败不中断其余分组（与浸没分析同款容错）
        logger.warn(`[RouteAnalysis] 3D Tiles 分组「${group.label}」注册失败（已跳过）:`, e)
      }
    }
    pingluLayerIds.value = ids
    pingluRegistered = ids.length > 0
  } catch (e) {
    logger.warn('[RouteAnalysis] 3D Tiles 瓦片集模板加载失败（已跳过 3D 图层）:', e)
  }
}

const stopTilesLayerWatch = watch(
  () => mapStore.currentRenderer,
  (renderer) => {
    if (!renderer) return
    if (isTiles3DCapable(renderer)) {
      if (pingluRegistered) return
      void registerPingluGroups()
    } else if (pingluRegistered) {
      // 切到 2D 渲染器：3D Tiles 无对应能力，移除本页 3D 独占图层，避免面板留死开关
      for (const id of pingluLayerIds.value) businessLayerManager.remove(id)
      pingluLayerIds.value = []
      pingluRegistered = false
    }
  },
  { immediate: true }
)

// 离线影像块：与 3D Tiles 同款能力守卫驱动；默认开启，用于与模型对照核验落位
const stopImageryWatch = watch(
  () => mapStore.currentRenderer,
  (renderer) => {
    if (!renderer) return
    if (isImageOverlayCapable(renderer)) {
      void registerImageryLayers()
    } else if (imageryRegistered) {
      for (const id of imageryLayerIds.value) businessLayerManager.remove(id)
      imageryLayerIds.value = []
      imageryRegistered = false
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  // 先停 watch（否则后续 renderer 变化仍会重新挂上），再摘当前实例上的监听
  stopRendererWatch()
  stopTilesLayerWatch()
  stopImageryWatch()
  mapStore.currentRenderer?.off?.('click', handleRendererClick)
})
</script>

<template>
  <div class="route-analysis-page">
    <AppLayout>
      <!-- 左下：路径结果摘要面板 -->
      <template #left>
        <GCSPanel :w="4" :h="4" anchor="top-left" :offset-x="0" :offset-y="1.25">
          <div class="result-panel">
            <h3 class="panel-title">路径结果</h3>
            <template v-if="summary">
              <div class="summary-main">{{ summary.totalKm.toFixed(1) }} km</div>
              <div class="summary-sub">
                约 {{ summary.totalMin.toFixed(1) }} 分钟 · {{ summary.segCount }} 段
              </div>
              <div class="summary-sub">含接驳 {{ summary.totalWithSnapKm.toFixed(1) }} km</div>
            </template>
            <div v-else class="result-hint">
              在右侧面板选择起点与终点后点击「开始查询」；途径点可选（最多 2 个）
            </div>
            <button class="clear-btn" @click="panelRef?.handleClear()">清除全部</button>
          </div>
        </GCSPanel>
      </template>

      <!-- 右下：图层控制 -->
      <template #right>
        <RouteControlPanel
          ref="panelRef"
          :manager="businessLayerManager"
          :task-slot="routeTaskSlot"
          :draggable="true"
          @query-result="handleQueryResult"
          @cleared="handleCleared"
          @dock="handleDock"
        />
        <GCSPanel :w="4" :h="4" anchor="top-right" :offset-x="0" :offset-y="5.5">
          <LayerControlPanel
            :layer-order="[
              'base-image',
              'base-vector',
              'boundary',
              ROUTE_PATH_LAYER_ID,
              ROUTE_ENDPOINT_LAYER_ID,
              ...PINGLU_GROUPS.map((g) => pingluLayerId(g.id)),
              ...imageryLayerIds,
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

.result-panel {
  padding: 12px;
  color: var(--GCS-text-primary);
}

.panel-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--GCS-text-primary);
}

.summary-main {
  font-size: 20px;
  font-weight: 600;
  color: var(--GCS-color-primary);
}

.summary-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--GCS-text-regular);
}

.summary-hint {
  margin-top: 8px;
  font-size: 10px;
  color: var(--GCS-text-muted);
}

.result-hint {
  color: var(--GCS-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.clear-btn {
  margin-top: 12px;
  padding: 4px 10px;
  border: 1px solid var(--GCS-border-default);
  border-radius: 4px;
  background: var(--GCS-bg-elevated);
  color: var(--GCS-text-regular);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.clear-btn:hover {
  border-color: var(--GCS-color-primary);
  color: var(--GCS-color-primary);
}
</style>
