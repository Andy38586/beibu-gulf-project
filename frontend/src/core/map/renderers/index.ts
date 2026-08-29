import { perfMark, perfMeasure, recordCesium } from '@/shared'

import type { MapRenderer } from './MapRenderer'
import { OLRenderer } from './OLRenderer'
import { preloadTerrain } from './terrainPreload'

export { MapRenderer, OLRenderer }

// Cesium 动态加载状态（模块级单例，防止重复加载）
let _cesiumLoadPromise: Promise<void> | null = null
let _preloadScheduled = false

/**
 * Cesium 空闲预热：首屏渲染后经 requestIdleCallback 真正执行加载（下载+解析执行 Cesium.js 5.7MB，
 * 仅 preload 缓存不解码，实测首次进 3D 仍卡）。
 * 与 createRenderer 共享同一 _cesiumLoadPromise：已预热则秒回，未预热用户操作优先，无重复下载。
 * 幂等：window.Cesium 就绪/已调度/已预热均跳过；失败静默（优化手段不阻断功能）。
 */
export function preloadCesium(): void {
  try {
    if ((window as unknown as Record<string, unknown>).Cesium) return
    if (_preloadScheduled) return
    _preloadScheduled = true

    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void })
      .requestIdleCallback
    const doPreload = () => {
      // 真正执行加载（与 ensureCesiumLoaded 共享 promise，3D 入口幂等秒回）
      void ensureCesiumLoaded()
        .then(() => {
          // 预热 CesiumRenderer 模块 chunk，进 3D 时不再现场拉取
          // 816-专项2 7-2：动态导入失败需自身兜底（外层 catch 只管 ensureCesiumLoaded）
          return import('./CesiumRenderer').catch(() => {
            // 预热失败静默——进 3D 时走正式加载路径
          })
        })
        // 地形预热串行在 Cesium（主库 + chunk）之后：先大后小，不抢带宽
        .then(() => preloadTerrain())
        .catch(() => {
          // 预热失败静默——只是优化手段，不影响功能（进 3D 时走正式加载路径）
        })
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console -- DEV 门控诊断（logger.debug 级别语义不同）
        console.debug('[renderers] Cesium 空闲预热（执行加载）已启动')
      }
    }
    if (idle) idle(doPreload)
    else doPreload()
  } catch {
    // 预热失败静默——只是优化手段，不影响功能
  }
}

/**
 * 确保 window.Cesium 就绪（幂等）：vite-plugin-cesium 将 `import { Viewer }` 转为
 * window.Cesium.Viewer 引用，但 Cesium.js 不再随 HTML 同步加载，须在 CesiumRenderer
 * chunk 被求值前动态注入 <script>。
 */
function ensureCesiumLoaded(): Promise<void> {
  if ((window as unknown as Record<string, unknown>).Cesium) return Promise.resolve()
  if (_cesiumLoadPromise) return _cesiumLoadPromise

  _cesiumLoadPromise = new Promise<void>((resolve, reject) => {
    // 埋点：脚本开始注入（度量口径为全局脚本 onload，非 import）
    perfMark('cesium:load-start')
    // 1. 注入 CSS（幂等：检查是否已存在）
    if (!document.querySelector('link[href*="Widgets/widgets.css"]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = '/cesium/Widgets/widgets.css'
      document.head.appendChild(link)
    }

    // 2. 动态加载 Cesium 主库
    const script = document.createElement('script')
    script.src = '/cesium/Cesium.js'
    script.onload = () => {
      perfMark('cesium:script-onload')
      _cesiumLoadPromise = null // 重置以支持重试
      resolve()
    }
    script.onerror = () => {
      _cesiumLoadPromise = null
      // 816-专项2 3-4：失败路径移除残留 <script> 节点，避免重复注入堆积 DOM
      script.remove()
      reject(new Error('Cesium.js 加载失败，请检查网络连接'))
    }
    document.head.appendChild(script)
  })

  return _cesiumLoadPromise
}

/** 创建渲染器：2D 静态导入首屏可用；3D 动态加载 Cesium.js（5.7MB，仅首次切 3D 时加载）+ 动态导入 CesiumRenderer */
export async function createRenderer(
  type: '2d' | '3d',
  container: HTMLElement
): Promise<MapRenderer> {
  if (type === '2d') {
    // 契约桥接：OLRenderer 与 MapRenderer 结构兼容（类未声明 implements，
    // 类型差异源于私有字段/签名细节），运行时契约由 UnifiedMap 按接口调用保证
    return new OLRenderer(container) as unknown as MapRenderer
  }

  // 1. 先加载 Cesium.js（5.7MB）→ window.Cesium 就绪
  perfMark('cesium:load-start') // 幂等：warm 切换时 ensureCesiumLoaded 早返回，保证标记存在
  await ensureCesiumLoaded()

  // 2. 再动态导入 CesiumRenderer（其 import cesium 已在构建期转为 window.Cesium 引用）
  const { CesiumRenderer } = await import('./CesiumRenderer')

  // 契约桥接：CesiumRenderer 动态导入无法静态实现接口，运行时按 MapRenderer 契约调用
  const renderer = new CesiumRenderer(container) as unknown as MapRenderer
  perfMark('cesium:viewer-ready')
  const scriptLoad = perfMeasure('cesium:script-load', 'cesium:load-start', 'cesium:script-onload')
  const viewerInit = perfMeasure(
    'cesium:viewer-init',
    'cesium:script-onload',
    'cesium:viewer-ready'
  )
  const total = perfMeasure('cesium:total', 'cesium:load-start', 'cesium:viewer-ready')
  recordCesium({
    scriptOnloadMs: scriptLoad ?? undefined,
    viewerReadyMs: viewerInit ?? undefined,
    totalMs: total ?? undefined,
  })
  return renderer
}
