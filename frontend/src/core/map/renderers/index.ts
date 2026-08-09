import { perfMark, perfMeasure, recordCesium } from '@/shared/utils/perfReporter'

import type { MapRenderer } from './MapRenderer'
import { OLRenderer } from './OLRenderer'

export { MapRenderer, OLRenderer }

// Cesium 动态加载状态（模块级单例，防止重复加载）
let _cesiumLoadPromise: Promise<void> | null = null
let _preloadScheduled = false

/**
 * Cesium 空闲预热（Phase 2 升级版，2026-08-06）
 *
 * 原实现仅 <link rel=preload> 预取到浏览器缓存（不执行）——用户实测"第一次进浸没分析
 * 还是很卡"：进 3D 时 ensureCesiumLoaded 注入 <script> 仍要现场解析执行 5.7MB 脚本。
 *
 * 升级为**真正执行加载**（交互优先队列）：
 * 1. 首屏渲染完成后，requestIdleCallback 空闲时段执行 ensureCesiumLoaded()
 *    （注入 script 下载+解析执行 Cesium.js）+ 预热 CesiumRenderer 模块 chunk
 * 2. 与 createRenderer 共享 _cesiumLoadPromise——用户点击进 3D 时：
 *    - preload 已跑完 → ensureCesiumLoaded 秒回，只差 new Viewer（~52ms）
 *    - preload 未跑（用户快速进 3D）→ createRenderer 直接触发加载，用户操作优先
 *    - preload 正在跑 → 共享同一 promise，无重复下载/执行（浏览器同 URL 复用）
 * 3. 幂等：window.Cesium 就绪 / 已调度 / 已预热均跳过；失败静默（优化手段不阻断功能）
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
      void ensureCesiumLoaded().then(() => {
        // 预热 CesiumRenderer 模块 chunk（CesiumWaterSurface/LayerRegistrar 等），
        // 进 3D 时不再现场拉 chunk
        void import('./CesiumRenderer')
      })
      if (import.meta.env.DEV) {
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
