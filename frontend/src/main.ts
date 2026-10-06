import './style.css'
// Element Plus 暗色主题变量（html.dark 钩子由 useTheme 同步切换；按需引入组件不含 dark 变量）
import 'element-plus/theme-chalk/dark/css-vars.css'
// EP 变量 → GCS token 映射（须在 EP dark css-vars 之后加载，见文件头注释）
import './assets/element-plus-overrides.css'
import { createPinia } from 'pinia'
import type { ComponentPublicInstance } from 'vue'
import { createApp } from 'vue'

import { preloadCesium } from '@/core'
import {
  captureError,
  initErrorReporting,
  initPerfReporter,
  logger,
  perfReportError,
  useTheme,
} from '@/shared'

import App from './App.vue'
import router from './router'

/** 启动时校验关键环境变量：必需项缺失报错，非必需项缺失告警不阻断 */
function validateEnv(): void {
  const warnings: string[] = []
  const errors: string[] = []

  // 必需：天地图 KEY，缺失则底图无法加载
  if (!import.meta.env.VITE_TIANDITU_KEY) {
    errors.push('VITE_TIANDITU_KEY 缺失：地图底图无法加载，请在 .env 文件中配置')
  }

  // 非必需：API 基础路径（有 fallback '/api'）
  if (!import.meta.env.VITE_API_BASE) {
    warnings.push('VITE_API_BASE 未配置，使用默认值 /api')
  }

  warnings.forEach((msg: string) => logger.warn(`[env] ${msg}`))
  errors.forEach((msg: string) => logger.error(`[env] ${msg}`))
}

validateEnv()

// z037：3D 直链首屏不做「首帧后错峰」——首屏本身就是 3D 页时，Cesium（5.8 MB）的下载
// 必须从启动即与路由 chunk 并行，而不是等壳首帧画完才起步（实测后者把 /flood-analysis
// 直链压到 A-6 预算 5000 ms 的边缘：4535/4535/4536 ms）。判据取自路由表 meta.engine
// （单一来源 = business/manifest.ts 派生），不写死路径清单；2D 直链不受影响，仍走
// App.vue 的 warmupAfterFirstFrame 空闲预热（不与首屏抢带宽）。
if (router.resolve(window.location.pathname).meta?.engine === '3d') {
  preloadCesium()
}

// 尽早挂载性能观察者，捕获 FCP/LCP/TTI/longtask（dev-only，不进生产包）
initPerfReporter()

// 错误上报（z021）：仅当 VITE_SENTRY_DSN 配置时初始化；未配置为 no-op，本地/CI 零影响
void initErrorReporting()

// 2026-09-10（阶段 4）：floodAdapter 的 fetch/calculate 双模式已收敛为单模式
//（algorithm-service 退役，能力由 Nest+PostGIS 覆盖），VITE_DATA_SOURCE 环境变量
// 与 setDataSource 初始化一并移除。

// ResizeObserver polyfill for Safari < 13.1（按需动态导入）
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  import('resize-observer-polyfill')
    .then(({ default: ResizeObserverPolyfill }) => {
      window.ResizeObserver = ResizeObserverPolyfill
    })
    .catch(() => {
      logger.warn('ResizeObserver polyfill 加载失败，部分响应式布局可能不可用')
    })
}

const app = createApp(App)

app.use(createPinia())
app.use(router)

// 主题初始化（mount 前应用 data-theme，避免首帧闪白/闪黑）
useTheme().initTheme()

// 全局错误处理，给用户反馈
app.config.errorHandler = (
  err: unknown,
  instance: ComponentPublicInstance | null,
  info: string
): void => {
  logger.error('[Global Error]', err, info)
  // 性能埋点：Vue 渲染/生命周期错误计数（生产可见）
  perfReportError('vue')
  // 上报（z021）：未配置 VITE_SENTRY_DSN 时是 no-op
  captureError(err, { source: 'vue.errorHandler', info })
  // 开发环境显示详细错误，生产环境显示友好提示
  logger.error('错误详情:', { err, instance, info })
}

// 窗口级兜底——捕获未被 Vue errorHandler 覆盖的错误
window.onerror = (message, source, lineno, colno, error) => {
  logger.error('[window.onerror]', { message, source, lineno, colno, error })
  perfReportError('script')
  captureError(error ?? new Error(String(message)), {
    source: 'window.onerror',
    sourceUrl: source,
    lineno,
    colno,
  })
}
window.onunhandledrejection = (event: PromiseRejectionEvent) => {
  logger.error('[unhandledrejection]', event.reason)
  perfReportError('promise')
  captureError(event.reason, { source: 'window.onunhandledrejection' })
}
// 资源加载错误（script/link/img 不冒泡到 window.onerror）——
// 捕获 Cesium.js / 天地图瓦片 / JS chunk 加载失败，统一 trace（本地日志 + perf 计数，
// 不上报 Sentry：瓦片失败是高频事件，上报会淹没真错误；上报口径见 errorReporting.ts）
window.addEventListener(
  'error',
  (event) => {
    const target = event.target as HTMLElement | null
    if (
      target &&
      (target.tagName === 'SCRIPT' || target.tagName === 'LINK' || target.tagName === 'IMG')
    ) {
      logger.error('[resource error]', {
        tag: target.tagName,
        src:
          (target as HTMLScriptElement | HTMLImageElement).src || (target as HTMLLinkElement).href,
      })
      perfReportError('resource')
    }
  },
  true
)

app.mount('#app')
