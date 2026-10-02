/**
 * 图层 key 的**唯一权威表**。
 *
 * ## 治什么
 *
 * 图层 id 此前是散落的字面量：公共 4 个 key（底图 ×2 / 边界 / 港口）分布在
 * `UnifiedMap.vue`（注册）、`mapStore.ts`（localStorage 合法值白名单）、
 * `LayerControlPanel.vue`（面板默认顺序）与 3 个业务页的 `layer-order` 数组里
 * —— 改一个 id 要人肉扫 6+ 处，漏一处即「图层面板按钮静默消失」（不报错，
 * 只是点不动，因为面板按 key 匹配目录条目）。
 *
 * `mapStore.ts` 原来的注释就写着「与 UnifiedMap.vue registerBaseLayer 注册处同源」
 * —— 那是**手抄的同源**，靠注释维持（注释不会随代码漂）。本表把它变成派生：
 * 谁要 key 都从这里取，同源由 import 保证而不是由注释保证。
 *
 * ## 为什么**不**收旧版选址域的历史 key（该域已于 2026-10-02 移除）
 *
 * 该模块待整体移除（2026-09-25 用户裁定），且其 key 已单源在 `useAnalysisLayer.ts`
 * 内、无复制债。收进来只会在移除时留下悬空项 —— 权威表要的是「在用且会漂的」那些。
 *
 * ## 纪律
 *
 * 值就是渲染器 / `BusinessLayerManager` registry 认的字符串字面量。
 * **本文件之外不得再出现同名字面量**；新图层一律先在此登记、再引用。
 */

export const LAYER_KEYS = {
  // ── 公共底图与基础图层（core/map 注册；面板与各业务页 layer-order 共用）──
  baseImage: 'base-image',
  baseVector: 'base-vector',
  boundary: 'boundary',
  ports: 'ports',
  // 真地形（3D Only，layerType 为 terrain，默认关；与 3D Tiles 互斥）
  // key 用 real-terrain 而非 terrain：避免与 layerType 字面量同名，
  // 否则 layer-keys 守卫会把 register 区域内的 layerType 字面量误判为裸写 key
  terrain: 'real-terrain',

  // ── 洪涝域（FloodAnalysisPage 注册）──
  floodArea: 'flood-area',
  floodWaterSurface: 'flood-water-surface',
  floodFacilities: 'flood-facilities',

  // ── 航线域（useRouteLayer 注册）──
  routePath: 'route-path',
  routeEndpoint: 'route-endpoint',
} as const

/** 公共底图 key（互斥单选的那一对：影像 / 矢量），供 store 白名单与面板使用 */
export const BASE_LAYER_KEYS: readonly string[] = [LAYER_KEYS.baseImage, LAYER_KEYS.baseVector]

/**
 * 图层面板默认顺序（公共底图 + 基础层）。
 * 业务页在 `:layer-order` 上以自己的域图层**续写**，故这里只放全页共有的前缀，
 * 不掺任何域图层 —— 否则每个业务页都要重复一遍自己那几项的顺序。
 */
export const DEFAULT_LAYER_ORDER: readonly string[] = [
  LAYER_KEYS.baseImage,
  LAYER_KEYS.baseVector,
  LAYER_KEYS.boundary,
  LAYER_KEYS.ports,
  // 真地形放基础层之后（3D Only，默认关）
  LAYER_KEYS.terrain,
]

/** 预测域图层 key 前缀：每个指标一张图层。**不导出** —— 外部只该用下面那个构造器 */
const FORECAST_LAYER_PREFIX = 'forecast-'

/**
 * 由指标得到预测图层 key。
 *
 * 为什么必须有这个构造器：注册侧（`useForecastLayer`）用的是模板串
 * `forecast-${indicator}`，而面板 `layer-order` 此前**手抄成字面量**
 * （`forecast-cargo` / `forecast-activity` / `forecast-container`）。
 * 两边靠"看起来一样"维持 —— 指标一改名，面板按钮就对不上目录条目而静默消失。
 * 收敛成同一个函数后，同源由调用保证。
 */
export function forecastLayerId(indicator: string): string {
  return FORECAST_LAYER_PREFIX + indicator
}

/** 新选址适宜性主图层 key（唯一一张；权重变化只 updateData 不换 key） */
export const SITE_SUITABILITY_LAYER_KEY = 'site-suitability-main'
