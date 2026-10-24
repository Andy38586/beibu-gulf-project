/**
 * Layer Adapter Registry：每种 layerType 对应 create/update/remove 一组适配函数。
 * BLM（业务图层管理器）只查 registry 调 adapter，不关心渲染细节；
 * 新增 layerType 只需在此加条目。
 */

import type { FeatureCollection } from 'geojson'

import { logger } from '@/shared'
import type {
  EngineName,
  GeoTIFFCapability,
  HeatmapCapability,
  ImageOverlayCapability,
  ImageOverlayData,
  LayerOptions,
  MapRenderer,
  PointFeature,
  PolygonFeature,
  TerrainToggleCapability,
  Tiles3DCapability,
  Water3DCapability,
} from '@/types'
import { DEFAULT_ENGINES, ENGINE_NAMES } from '@/types'
import type { LayerType, Tiles3DData, WaterSurfaceData } from '@/types/core/layerManager'

// ===== 引擎适用性（面板三态）=====

/**
 * 图层在当前引擎下的呈现四态：
 *   · on / off —— 适用当前引擎，按钮可点（蓝=在显示）
 *   · unsupported —— 单引擎特化图层遇到另一引擎：**不可点亮**（原先只有两态，这类条目
 *     照样可点亮，点了什么也不会发生——BLM.reapplyAll 会按引擎跳过创建）
 *   · not-mounted —— 开关是"想显示"，但 BLM 重绘后该层没上屏（data 未就绪，a029）：
 *     标灰但**仍可点**（点一次关掉它，或等数据到位后自动变蓝），不再让用户以为是自己看错
 */
type LayerPanelState = 'on' | 'off' | 'unsupported' | 'not-mounted'

/**
 * 四态判定（纯函数，供面板与单测共用）。
 * engines 缺省视为双引擎通用；currentEngine 未就绪（null）时不下"不支持"结论——
 * 渲染器还没起来就标灰会误导（此时点了也只会等渲染器就绪）。
 * notMounted 仅在"想显示"时才有意义：关着的图层谈不上"没上屏"。
 */
export function resolveLayerPanelState(
  engines: EngineName[] | undefined,
  visible: boolean,
  currentEngine: EngineName | null,
  notMounted = false
): LayerPanelState {
  if (engines && currentEngine && !engines.includes(currentEngine)) return 'unsupported'
  if (notMounted && visible) return 'not-mounted'
  return visible ? 'on' : 'off'
}

// ===== 数据形状守卫 =====
// 仅做最小形态校验（数组 / FeatureCollection），把"静默渲染失败"变成"明确抛错"，
// 调用方 catch 后用户可见真实文案；不做完整 schema 校验（避免过度设计）。

/** 要素上限：超限直接抛错，防止误传超大集合拖垮渲染（潜伏 OOM 缺口） */
const MAX_FEATURES = 500_000

function assertPointArray(data: unknown): asserts data is PointFeature[] {
  if (!Array.isArray(data)) {
    throw new Error(
      `[layerAdapters] points/heatmap 图层数据必须是 PointFeature[]，实际: ${typeof data}`
    )
  }
  if (data.length > MAX_FEATURES) {
    throw new Error(
      `[layerAdapters] 要素数超上限（${MAX_FEATURES}），实际 ${data.length}，请分批或裁剪`
    )
  }
}

function assertFeatureCollection(data: unknown): asserts data is FeatureCollection {
  if (
    !data ||
    typeof data !== 'object' ||
    (data as FeatureCollection).type !== 'FeatureCollection'
  ) {
    throw new Error('[layerAdapters] geojson 图层数据必须是 FeatureCollection')
  }
  const features = (data as FeatureCollection).features ?? []
  if (features.length > MAX_FEATURES) {
    throw new Error(
      `[layerAdapters] 要素数超上限（${MAX_FEATURES}），实际 ${features.length}，请分批或裁剪`
    )
  }
}

function assertPolygonArray(data: unknown): asserts data is PolygonFeature[] {
  if (!Array.isArray(data)) {
    throw new Error(`[layerAdapters] polygon 图层数据必须是 PolygonFeature[]，实际: ${typeof data}`)
  }
  if (data.length > MAX_FEATURES) {
    throw new Error(
      `[layerAdapters] 要素数超上限（${MAX_FEATURES}），实际 ${data.length}，请分批或裁剪`
    )
  }
}

/** 能力守卫的唯一实现：某方法存在即认为具备该能力（六个 isXxxCapable 共用） */
function hasCapability<C>(renderer: MapRenderer, method: string): renderer is MapRenderer & C {
  return typeof (renderer as unknown as Record<string, unknown>)[method] === 'function'
}

/** 水面能力检查：渲染器是否实现 Water3DCapability（3D 专用，仅 CesiumRenderer）。
 *  对外导出——业务页注册水面/DEM 前用能力检查替代 getType() 引擎判断 */
export function isWater3DCapable(
  renderer: MapRenderer
): renderer is MapRenderer & Water3DCapability {
  return hasCapability<Water3DCapability>(renderer, 'addWaterSurface')
}

/** GeoTIFF 能力检查：Cesium 独占（3D hillshade 贴图回退；OL 2D COG 已按 Cesium 独占定义移除） */
function isGeoTIFFCapable(renderer: MapRenderer): renderer is MapRenderer & GeoTIFFCapability {
  return hasCapability<GeoTIFFCapability>(renderer, 'addGeoTIFFLayer')
}

/** geotiff 创建/重建共用的失败上行半边（a029）：addGeoTIFFLayer 以**返回值**表达失败（不抛
 *  异常）——3D 非 hillshade 回退在 `CesiumRenderer.addGeoTIFFLayer` 里 `return false`，
 *  投影/imageryLayers 构造或 PNG 加载失败同样 return false。返回值曾被整体丢弃 ⇒ 图层开关
 *  仍是"已开"、屏幕无物、BLM 无从感知。false ⇒ warn + onError，BLM 据以回滚
 *  registry/catalog 并弹 toast（与 imageOverlay 同款收口）。文案按动作词区分，逐字节不变。 */
function applyGeoTIFFOrReport(
  renderer: MapRenderer & GeoTIFFCapability,
  key: string,
  data: unknown,
  options: LayerOptions,
  action: '创建' | '重建'
): void {
  if (!renderer.addGeoTIFFLayer(key, data as string, options)) {
    logger.warn(`[layerAdapters] geotiff 图层 ${key} ${action}失败`)
    options.onError?.(new Error(`geotiff 图层${action}失败: ${key}`))
  }
}

/** 热力图能力检查：仅 OL 实现（2D Only） */
function isHeatmapCapable(renderer: MapRenderer): renderer is MapRenderer & HeatmapCapability {
  return hasCapability<HeatmapCapability>(renderer, 'addHeatmapLayer')
}

/** 3D Tiles 能力检查：仅 Cesium 实现（Cesium3DTileset 流式加载瓦片集）。
 *  对外导出——业务页注册 3D Tiles 前用能力检查替代 getType() 引擎判断 */
export function isTiles3DCapable(
  renderer: MapRenderer
): renderer is MapRenderer & Tiles3DCapability {
  return hasCapability<Tiles3DCapability>(renderer, 'add3DTilesLayer')
}

/** 单张影像覆盖能力检查：仅 Cesium 实现（SingleTileImageryProvider 按矩形铺图）。
 *  对外导出——业务页注册影像块前用能力检查替代 getType() 引擎判断 */
export function isImageOverlayCapable(
  renderer: MapRenderer
): renderer is MapRenderer & ImageOverlayCapability {
  return hasCapability<ImageOverlayCapability>(renderer, 'addImageOverlayLayer')
}

/**
 * 3dtiles 异步失败上行（逐行审计 K4-2 收口）：add3DTilesLayer 是 async 且以 resolve(false)
 * 表达失败（不抛）——只挂 .catch 等于失败永不触发；上行必须走 onError（BLM 据此回滚
 * registry/catalog 并提示重试）。create/重建两路同构，收口一处（同 applyGeoTIFFOrReport 形状）。
 */
function report3DTilesFailure(
  promise: Promise<boolean | void>,
  key: string,
  action: '创建' | '重建',
  options: LayerOptions
): void {
  void promise
    .then((ok) => {
      if (ok === false) {
        logger.warn(`[layerAdapters] 3dtiles 图层 ${key} ${action}失败（异步）`)
        options.onError?.(new Error(`3dtiles 图层${action}失败: ${key}`))
      }
    })
    .catch((e) => {
      logger.warn(`[layerAdapters] 3dtiles 图层 ${key} ${action}异常（异步）:`, e)
      options.onError?.(e)
    })
}

/** 单张影像覆盖创建/重建半边（同 applyGeoTIFFOrReport 形状）：addImageOverlayLayer 以
 *  **返回值**表达失败（不抛异常），返回值此前被整体丢弃 ⇒ 图片 404 / SingleTileImageryProvider
 *  构造抛错时，图层开关仍是"已开"、屏幕无物。create 与重建两条路径若各自手抄这段，任一侧
 *  漏改就会让失败只剩一半上行（04-D2/D4）。文案按动作词区分，逐字节不变。 */
function applyImageOverlayOrReport(
  renderer: MapRenderer & ImageOverlayCapability,
  key: string,
  payload: ImageOverlayData,
  options: LayerOptions,
  action: '创建' | '重建'
): void {
  if (!renderer.addImageOverlayLayer(key, payload, options)) {
    logger.warn(`[layerAdapters] imageOverlay 图层 ${key} ${action}失败`)
    options.onError?.(new Error(`imageOverlay 图层${action}失败: ${key}`))
  }
}

/** 3dtiles 创建/重建半边（同 applyGeoTIFFOrReport 形状）：create 与重建必须共用同一份载荷
 *  校验与渲染选项——分开手抄时任一侧漏改 maximumScreenSpaceError 会让两条路径参数漂移；
 *  重建先移除旧层再按新 URL 建，失败上行统一走 report3DTilesFailure。
 *  返回 false = 载荷不合格（create 侧据此 warn，重建侧静默跳过——与 02 §5.3 的"设计内跳过
 *  不打扰用户"一致）。 */
function applyTiles3DOrReport(
  renderer: MapRenderer & Tiles3DCapability,
  key: string,
  data: unknown,
  options: LayerOptions,
  action: '创建' | '重建',
  rebuild: boolean
): boolean {
  const payload = data as Tiles3DData
  if (!payload || typeof payload.url !== 'string' || payload.url === '') return false
  if (rebuild) renderer.removeLayer(key)
  report3DTilesFailure(
    Promise.resolve(
      renderer.add3DTilesLayer(key, payload.url, {
        ...options,
        maximumScreenSpaceError: payload.maximumScreenSpaceError,
      })
    ),
    key,
    action,
    options
  )
  return true
}

/** 真地形开关能力检查：仅 Cesium 实现（setTerrainEnabled 切换 terrainProvider）。
 *  对外导出——业务页注册真地形图层前用能力检查替代 getType() 引擎判断 */
function isTerrainCapable(
  renderer: MapRenderer
): renderer is MapRenderer & TerrainToggleCapability {
  return hasCapability<TerrainToggleCapability>(renderer, 'setTerrainEnabled')
}

/** Adapter 函数签名 */
interface LayerAdapter {
  create: (renderer: MapRenderer, key: string, data: unknown, options: LayerOptions) => void
  update: (renderer: MapRenderer, key: string, data: unknown, options: LayerOptions) => void
  remove: (renderer: MapRenderer, key: string) => void
  /** 可选显隐分派：特殊图层（如水面不存于普通图层表）在此直接委派，避免落入待定显隐队列 */
  setVisibility?: (renderer: MapRenderer, key: string, visible: boolean) => void
  /** 该 layerType 的真实引擎支持面（registry engines 缺省值来源——按能力声明，不虚标） */
  engines: EngineName[]
}

/** 通用移除：7 个 adapter 的 remove 逐字相同（水面/地形有独立能力检查，不在此列） */
const removeLayerAdapter: LayerAdapter['remove'] = (renderer, key) => renderer.removeLayer(key)

export const LAYER_ADAPTERS: Record<LayerType, LayerAdapter> = {
  heatmap: {
    engines: [ENGINE_NAMES.OPENLAYERS], // addHeatmapLayer 为 OL 独有能力
    // addHeatmapLayer 为可选能力（2D Only），经类型守卫后调用，替代 ! 断言
    create: (renderer, key, data, options) => {
      assertPointArray(data)
      if (!isHeatmapCapable(renderer)) {
        logger.warn(`[layerAdapters] heatmap 图层 ${key} 当前渲染器不支持，跳过`)
        return
      }
      renderer.addHeatmapLayer(key, data, options)
    },
    update: (renderer, key, data, options) => {
      assertPointArray(data)
      if (!isHeatmapCapable(renderer)) {
        logger.warn(`[layerAdapters] heatmap 图层 ${key} 更新跳过（渲染器不支持）`)
        return
      }
      renderer.updateHeatmapLayer(key, data, options)
    },
    remove: removeLayerAdapter,
  },

  geojson: {
    engines: DEFAULT_ENGINES,
    create: (renderer, key, data, options) => {
      assertFeatureCollection(data)
      renderer.addGeoJsonLayer(key, data, options)
    },
    update: (renderer, key, data, options) => {
      assertFeatureCollection(data)
      // 优先走渲染器增量更新（复用 dataSource/source，避免重建闪烁）；
      // 无增量能力的渲染器回退 remove+add
      const updater = (
        renderer as Partial<MapRenderer> & {
          updateGeoJsonLayer?: (id: string, data: FeatureCollection, options: LayerOptions) => void
        }
      ).updateGeoJsonLayer
      if (typeof updater === 'function') {
        updater.call(renderer, key, data, options)
      } else {
        renderer.removeLayer(key)
        renderer.addGeoJsonLayer(key, data, options)
      }
    },
    remove: removeLayerAdapter,
  },

  points: {
    engines: DEFAULT_ENGINES,
    create: (renderer, key, data, options) => {
      assertPointArray(data)
      renderer.addPointLayer(key, data, options)
    },
    update: (renderer, key, data, options) => {
      assertPointArray(data)
      renderer.removeLayer(key)
      renderer.addPointLayer(key, data, options)
    },
    remove: removeLayerAdapter,
  },

  polygon: {
    engines: DEFAULT_ENGINES,
    create: (renderer, key, data, options) => {
      assertPolygonArray(data)
      renderer.addPolygonLayer(key, data, options)
    },
    update: (renderer, key, data, options) => {
      assertPolygonArray(data)
      renderer.removeLayer(key)
      renderer.addPolygonLayer(key, data, options)
    },
    remove: removeLayerAdapter,
  },

  waterSurface: {
    engines: [ENGINE_NAMES.CESIUM], // 水面为 3D 专有能力（Water3DCapability），OLRenderer 无此方法
    // 水面为 3D 专有能力（Water3DCapability），OLRenderer 无此方法；
    // 能力检查替代基类 no-op stub：不支持的渲染器上跳过并 warn
    create: (renderer, key, data, options) => {
      if (!isWater3DCapable(renderer)) {
        logger.warn(
          `[layerAdapters] waterSurface 图层仅 3D 渲染器支持，当前 ${renderer.getType()} 跳过: ${key}`
        )
        return
      }
      const payload = data as WaterSurfaceData
      // addWaterSurface 为 async（真地形采样基准），rejection 兜底防浮动 Promise
      void Promise.resolve(
        renderer.addWaterSurface(key, payload.coordinates, payload.height, options)
      ).catch((e) => {
        logger.warn(`[layerAdapters] 水面图层 ${key} 创建失败（异步）:`, e)
      })
    },
    update: (renderer, key, data, _options) => {
      if (!isWater3DCapable(renderer)) return
      const payload = data as WaterSurfaceData
      renderer.updateWaterLevel(key, payload.height)
    },
    remove: (renderer, key) => {
      if (!isWater3DCapable(renderer)) return
      renderer.removeWaterSurface(key)
    },
    // 水面不存于普通图层表，默认显隐会落入待定队列失效——直接委派 setWaterSurfaceVisibility
    setVisibility: (renderer, key, visible) => {
      if (!isWater3DCapable(renderer)) return
      renderer.setWaterSurfaceVisibility(key, visible)
    },
  },

  geotiff: {
    engines: [ENGINE_NAMES.CESIUM], // GeoTIFF 为 Cesium 独占能力（OL 2D COG 已按独占定义移除）
    // addGeoTIFFLayer 为 Cesium 独占能力（3D hillshade 贴图回退；OL 2D 已按独占定义移除），
    // 经类型守卫后调用；data 为 hillshade PNG 路径。3D 下 DEM（数字高程模型）也是独立影像图层，
    // 与普通图层走同一显隐语义，不做 terrainProvider 特殊处理
    create: (renderer, key, data, options) => {
      if (!isGeoTIFFCapable(renderer)) {
        logger.warn(`[layerAdapters] geotiff 图层 ${key} 当前渲染器不支持，跳过`)
        return
      }
      applyGeoTIFFOrReport(renderer, key, data, options, '创建')
    },
    update: (renderer, key, data, options) => {
      if (!isGeoTIFFCapable(renderer)) {
        logger.warn(`[layerAdapters] geotiff 图层 ${key} 更新跳过（渲染器不支持）`)
        return
      }
      renderer.removeLayer(key)
      // create 的同族半边（重建语义同 imageOverlay：移除后按新内容重加）
      applyGeoTIFFOrReport(renderer, key, data, options, '重建')
    },
    remove: removeLayerAdapter,
    /**
     * geotiff 图层显隐委派（纯显隐，**不联动真地形**）。
     *
     * 修复（2026-09-21）：原实现额外调 `renderer.setTerrainEnabled(visible)`，使
     * 「关掉山影贴图」连带把 z 起伏也关掉——与本文件上一版注释自述的「DEM 与真地形
     * 互不耦合」直接矛盾（注释与实现打对台，属 AGENTS.md §四第 6 条要停下发问的情形）。
     * 更根本的问题是：真地形 z 起伏是**随底图加载的基础能力**（CesiumRenderer 挂载时
     * 自建，`_terrainEnabled` 默认 true），不应由某个业务图层的开关注释其生死。
     * 现切断联动：地形由渲染器自行管理，业务图层只管自己的显隐。
     */
    setVisibility: (renderer, key, visible) => {
      renderer.setVisibility(key, visible)
    },
  },

  // 3D Tiles（瓦片集）：Cesium 以 Cesium3DTileset 加载 glTF/b3dm 内容，OL 无对应概念
  '3dtiles': {
    engines: [ENGINE_NAMES.CESIUM],
    // 数据载荷 Tiles3DData { url, maximumScreenSpaceError }；add3DTilesLayer 为 async
    // （先取回 tileset.json 再建瓦片树），rejection 兜底防浮动 Promise（同 waterSurface 处理）
    create: (renderer, key, data, options) => {
      if (!isTiles3DCapable(renderer)) {
        logger.warn(
          `[layerAdapters] 3dtiles 图层仅 3D 渲染器支持，当前 ${renderer.getType()} 跳过: ${key}`
        )
        return
      }
      // add3DTilesLayer 是 async 且用 resolve(false) 表达失败（不抛）——失败上行走
      // report3DTilesFailure（BLM 据以回滚状态 + 提示重试），原 warn 被 DEV 门控致
      // 生产零痕迹（违 04-D2）的缺口已随收口闭合。载荷不合格 = 静默跳过，不打扰用户。
      if (!applyTiles3DOrReport(renderer, key, data, options, '创建', false)) {
        logger.warn(`[layerAdapters] 3dtiles 图层 ${key} 缺少 tileset.json 地址，跳过`)
      }
    },
    // 瓦片树与 URL 绑定，无法原地换内容 ⇒ 更新语义 = 移除后按新 URL 重建
    update: (renderer, key, data, options) => {
      if (!isTiles3DCapable(renderer)) return
      // 2026-10-05（1004-01）：BLM `_runAdapter` 的 update 分支改传同一份注入了
      // onError 的 options，本路径失败上行链路已通（前注「本路径拿不到 onError」作废）。
      applyTiles3DOrReport(renderer, key, data, options, '重建', true)
    },
    remove: removeLayerAdapter,
  },

  // 离线提取的影像块：按地理矩形铺一张图（与 3D Tiles 模型同源同坐标系，便于对齐核验）
  imageOverlay: {
    engines: [ENGINE_NAMES.CESIUM],
    create: (renderer, key, data, options) => {
      if (!isImageOverlayCapable(renderer)) {
        logger.warn(
          `[layerAdapters] imageOverlay 图层仅 3D 渲染器支持，当前 ${renderer.getType()} 跳过: ${key}`
        )
        return
      }
      const payload = data as ImageOverlayData
      if (
        !payload ||
        typeof payload.url !== 'string' ||
        !Array.isArray(payload.bbox) ||
        !Array.isArray(payload.size)
      ) {
        logger.warn(`[layerAdapters] imageOverlay 图层 ${key} 缺少 url/bbox/size，跳过`)
        return
      }
      // 注意：2D 无能力那条分支是设计内跳过（02 §5.3 水面同款），**不**报失败不弹 toast。
      applyImageOverlayOrReport(renderer, key, payload, options, '创建')
    },
    // provider 与 URL 绑定，换图只能重建（沿用 geotiff 的移除后重建语义）
    update: (renderer, key, data, options) => {
      if (!isImageOverlayCapable(renderer)) return
      const payload = data as ImageOverlayData
      if (!payload || typeof payload.url !== 'string') return
      renderer.removeLayer(key)
      applyImageOverlayOrReport(renderer, key, payload, options, '重建')
    },
    remove: removeLayerAdapter,
  },

  // 真地形（3D Only）：Cesium 经 setTerrainEnabled 在 CTB 真地形（z 起伏）与
  // 平坦椭球之间切换 scene.terrainProvider。默认关、进图层管理为可选图层，
  // 与 3D Tiles 互斥（见 BusinessLayerManager 的互斥处理）。
  terrain: {
    engines: [ENGINE_NAMES.CESIUM],
    create: (renderer, key) => {
      if (!isTerrainCapable(renderer)) {
        logger.warn(
          `[layerAdapters] terrain 图层仅 3D 渲染器支持，当前 ${renderer.getType()} 跳过: ${key}`
        )
        return
      }
      renderer.setTerrainEnabled(true)
    },
    update: (renderer) => {
      if (!isTerrainCapable(renderer)) return
      renderer.setTerrainEnabled(true)
    },
    remove: (renderer) => {
      if (!isTerrainCapable(renderer)) return
      renderer.setTerrainEnabled(false)
    },
    // 真地形不存于普通图层表，显隐直接委派 setTerrainEnabled（同水面处理）
    setVisibility: (renderer, _key, visible) => {
      if (!isTerrainCapable(renderer)) return
      renderer.setTerrainEnabled(visible)
    },
  },
}
