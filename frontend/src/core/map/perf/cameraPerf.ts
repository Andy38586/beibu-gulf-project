/**
 * cameraPerf —— 相机相关性能债落点（z038②③）。
 *
 * 为什么单独成文件：`CesiumRenderer.ts` / `OLRenderer.ts` 体量棘轮已冻结
 * （`tools/v3-guard/structure-check.mjs`，z016 裁定 A-1「不拆分 ⇒ 新增内容另开文件」）。
 *
 * ① 交互期降载（z038②）：相机 moveStart 隐藏「顶点规模达阈值」重图层、moveEnd 按各图层
 *    visible 权威值恢复——隐藏期只切引擎侧 show，不改面板状态。
 * ② 星空懒加载（z038③）：Viewer 以 `skyBox:false` 建成后，首帧之外经 idle 补建 Cesium
 *    自带 tycho2 星空（6 张纹理 ≈850KB 退出 3D 首进的带宽与解码）。
 */
import type { Viewer } from 'cesium'
import { buildModuleUrl, SkyBox } from 'cesium'

/** 图层条目的结构化最小面（隐藏/恢复只碰 visible 与引擎侧 show） */
interface DegradableLayer {
  instance: unknown
  visible: boolean
  interactionHeavy?: boolean
}

/** 水面条目的结构化最小面 */
interface DegradableWaterSurface {
  primitive: { show: boolean }
  visible: boolean
  interactionHeavy?: boolean
}

/** 宿主的结构化视图——不 import 回 CesiumRenderer，避免运行时环 */
interface CameraPerfHost {
  viewer: Viewer | null
  _cameraDebounceTimer: ReturnType<typeof setTimeout> | null
  _layers: Map<string, DegradableLayer>
  _waterSurfaces: { values(): Iterable<DegradableWaterSurface> } | null
  _doSetVisibility(id: string, visible: boolean): void
  _getCameraState(): unknown
  emit(event: 'camera-changed', data: unknown): void
}

/**
 * z038②：交互期降载阈值（顶点总数）——相机移动期间地表几何每帧重投影/重裁剪，
 * 成本≈顶点数；低于阈值隐藏反而闪烁且几乎无收益，故不登记。阈值按 914 审计实测取线
 * （boundary 5448 / 淹没单档 ≤6742 顶点）。
 */
const INTERACTION_HEAVY_VERTEX_THRESHOLD = 3000

/** 顶点规模是否达到交互期降载登记线 */
export function isHeavyVertexCount(vertexCount: number): boolean {
  return vertexCount >= INTERACTION_HEAVY_VERTEX_THRESHOLD
}

/** 递归累计坐标对数（GeoJSON/PolygonFeature 嵌套形态通吃；非法输入计 0） */
export function countCoordinatePairs(coords: unknown): number {
  if (!Array.isArray(coords) || coords.length === 0) return 0
  if (typeof coords[0] === 'number') return 1
  return coords.reduce<number>((sum, c) => sum + countCoordinatePairs(c), 0)
}

/** PolygonFeature[] 顶点成本（coordinates 优先，geometry.coordinates 兜底） */
export function isHeavyPolygons(
  features: Array<{ coordinates?: unknown; geometry?: { coordinates?: unknown } }>
): boolean {
  const cost = features.reduce(
    (sum, f) => sum + countCoordinatePairs(f.coordinates ?? f.geometry?.coordinates),
    0
  )
  return isHeavyVertexCount(cost)
}

/** GeoJSON FeatureCollection 顶点成本 */
export function isHeavyGeoJson(geojson: { features: Array<{ geometry?: unknown }> }): boolean {
  const cost = geojson.features.reduce((sum, f) => {
    const geometry = f.geometry as { coordinates?: unknown } | null | undefined
    return sum + countCoordinatePairs(geometry?.coordinates)
  }, 0)
  return isHeavyVertexCount(cost)
}

/**
 * 隐藏/恢复重图层（隐藏只切引擎侧 show，**不覆盖**面板权威值）：
 * 普通图层走 host._doSetVisibility（不改 entry.visible）；水面直接切 primitive.show
 * ——不能用 setWaterSurfaceVisibility，它会改写 water.visible，恢复时即丢权威值。
 */
function setInteractionHeavyLayersHidden(host: CameraPerfHost, hidden: boolean): void {
  for (const [id, layer] of host._layers) {
    if (layer.interactionHeavy) host._doSetVisibility(id, hidden ? false : layer.visible)
  }
  for (const water of host._waterSurfaces?.values() ?? []) {
    if (water.interactionHeavy) water.primitive.show = hidden ? false : water.visible
  }
}

/** 具名回调（WeakMap 持有，随 unbindPerf 摘除；不占渲染器字段） */
type CameraPerfHandlers = { changed: () => void; start: () => void; end: () => void }
const HANDLERS = new WeakMap<CameraPerfHost, CameraPerfHandlers>()

/**
 * 相机变化防抖（原 CesiumRenderer.setupCameraDebounce 迁入，行为不变）：changed 防抖 300ms
 * 后 requestRender + 回传相机状态；同处绑定交互期降载（z038②）。Viewer 单例复用 ⇒ 三个具名
 * 回调统一存 WeakMap，随 unbindPerf 摘除（匿名回调重挂即累加，历史事故同款）。
 */
export function setupCameraDebounce(host: CameraPerfHost): void {
  const viewer = alive(host)
  if (!viewer) return
  unbindPerf(host)
  const changed = (): void => {
    if (host._cameraDebounceTimer) clearTimeout(host._cameraDebounceTimer)
    host._cameraDebounceTimer = setTimeout(() => {
      // viewer 可能已置空，防御（真值判断内写非空断言等于没写）
      if (host.viewer) {
        host.viewer.scene.requestRender()
        host.emit('camera-changed', host._getCameraState())
      }
      host._cameraDebounceTimer = null
    }, 300)
  }
  const handlers: CameraPerfHandlers = {
    changed,
    start: () => setInteractionHeavyLayersHidden(host, true),
    end: () => setInteractionHeavyLayersHidden(host, false),
  }
  viewer.camera.changed.addEventListener(handlers.changed)
  viewer.camera.moveStart.addEventListener(handlers.start)
  viewer.camera.moveEnd.addEventListener(handlers.end)
  HANDLERS.set(host, handlers)
}

/** 摘除相机监听（changed + 交互期降载；viewer 已销毁时只清 WeakMap 记录） */
export function unbindPerf(host: CameraPerfHost): void {
  const handlers = HANDLERS.get(host)
  if (!handlers) return
  const camera = host.viewer?.camera
  camera?.changed.removeEventListener(handlers.changed)
  camera?.moveStart.removeEventListener(handlers.start)
  camera?.moveEnd.removeEventListener(handlers.end)
  HANDLERS.delete(host)
}

/** viewer 存活判据（与 CesiumRenderer.aliveViewer 同口径；避免 import 回渲染器） */
function alive(host: CameraPerfHost): Viewer | null {
  const viewer = host.viewer
  if (!viewer) return null
  if (viewer.isDestroyed()) return null
  return viewer
}

/**
 * 星空盒懒加载（z038③）：首帧画完后再经 idle 补建 Cesium 自带星空
 * （与默认实现同一份 6 张纹理）。失败静默：无星空不影响任何功能。
 */
export function scheduleLazySkyBox(viewer: Viewer): void {
  const install = (): void => {
    try {
      if (viewer.isDestroyed() || viewer.scene.skyBox) return
      viewer.scene.skyBox = new SkyBox({
        sources: {
          positiveX: buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_px.jpg'),
          negativeX: buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_mx.jpg'),
          positiveY: buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_py.jpg'),
          negativeY: buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_my.jpg'),
          positiveZ: buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_pz.jpg'),
          negativeZ: buildModuleUrl('Assets/Textures/SkyBox/tycho2t3_80_mz.jpg'),
        },
      })
      viewer.scene.requestRender()
    } catch {
      // 星空非功能必需：失败静默，保持无星空
    }
  }
  const scheduleIdle = (): void => {
    const idle = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void
      }
    ).requestIdleCallback
    if (idle) idle(install, { timeout: 3000 })
    else install()
  }
  // 再等一帧：确保首帧已经用「无星空」配置渲染出去，850KB 不占首进关键路径
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(scheduleIdle)
  } else {
    scheduleIdle()
  }
}
