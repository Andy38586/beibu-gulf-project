import { perfMark, perfMeasure, recordCesium } from '@/core/perf/PerfReporter'

import type { MapRenderer } from './MapRenderer'
import { OLRenderer } from './OLRenderer'

export { MapRenderer, OLRenderer }

// Cesium 动态加载状态（模块级单例，防止重复加载）
let _cesiumLoadPromise: Promise<void> | null = null

/**
 * 确保 Cesium 全局就绪（幂等）
 * vite-plugin-cesium 将 `import { Viewer } from 'cesium'` 转换为 `window.Cesium.Viewer` 引用，
 * 但 Cesium.js（5.7MB）不再在 HTML head 中同步加载。此函数在切 3D 时动态注入 <script> 标签，
 * 确保 CesiumRenderer 的 chunk 被求值前 window.Cesium 已就绪。
 */
function ensureCesiumLoaded(): Promise<void> {
  if ((window as unknown as Record<string, unknown>).Cesium) return Promise.resolve()
  if (_cesiumLoadPromise) return _cesiumLoadPromise

  _cesiumLoadPromise = new Promise<void>((resolve, reject) => {
    // Phase 0 埋点：标记 Cesium 脚本开始注入（★ 注意度量是全局脚本 onload，非 import）
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
      reject(new Error('Cesium.js 加载失败，请检查网络连接'))
    }
    document.head.appendChild(script)
  })

  return _cesiumLoadPromise
}

/**
 * 创建地图渲染器
 * - 2D（OL）：静态导入，首屏即可用
 * - 3D（Cesium）：动态加载 Cesium.js + 动态导入 CesiumRenderer
 * Cesium 5.7MB 仅在用户首次切换到 3D 视图时加载，首屏零开销
 */
export async function createRenderer(
  type: '2d' | '3d',
  container: HTMLElement
): Promise<MapRenderer> {
  if (type === '2d') {
    return new OLRenderer(container) as unknown as MapRenderer
  }

  // 1. 先加载 Cesium.js（5.7MB）→ window.Cesium 就绪
  perfMark('cesium:load-start') // 幂等：warm 切换时 ensureCesiumLoaded 早返回，保证标记存在
  await ensureCesiumLoaded()

  // 2. 再动态导入 CesiumRenderer（其 import cesium 已在构建期转为 window.Cesium 引用）
  const { CesiumRenderer } = await import('./CesiumRenderer')

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
