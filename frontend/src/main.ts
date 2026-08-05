import './style.css'
import { createPinia } from 'pinia'
import type { ComponentPublicInstance } from 'vue'
import { createApp } from 'vue'

import App from './App.vue'
import { initPerfReporter, perfReportError } from './shared/utils/perfReporter'
import router from './router'
import { floodAdapter } from './services/adapters/floodAdapter'
import { forecastAdapter } from './services/adapters/forecastAdapter'
import { siteAnalysisAdapter } from './services/adapters/siteAnalysisAdapter'
import { logger } from './shared/utils/logger'

/**
 * 启动时校验关键环境变量
 * 缺失非必需变量时告警但不阻断启动，缺失必需变量时报错
 */
function validateEnv(): void {
  const warnings: string[] = []
  const errors: string[] = []

  // 必需：天地图 KEY（无 KEY 地图底图无法加载）
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

// Phase 0 性能埋点：尽早挂载观察者，捕获 FCP/LCP/TTI/longtask（dev-only，不进生产包）
initPerfReporter()

// 数据源由环境变量驱动，默认 api（生产安全；未配置不再静默打包 mock）。
// 本地离线开发需显式设 VITE_DATA_SOURCE=mock（写入 .env.local，优先级高于 .env）。
const dataSource = (import.meta.env.VITE_DATA_SOURCE as 'mock' | 'api' | undefined) || 'api'
// 预测分析：真实指标（cargo/container）走后端 API；合成指标（berth/traffic）由 adapter
// 按 INDICATOR_SOURCE 回退到前端静态 fixture（public/data/forecast/*）。
// 三个 adapter 统一由 dataSource 驱动，移除 forecast 硬编码 'api' 覆盖（D-1=A，避免绕过全局语义）。
forecastAdapter.setDataSource(dataSource)
floodAdapter.setDataSource(dataSource)
siteAnalysisAdapter.setDataSource(dataSource)

// ResizeObserver polyfill for Safari < 13.1
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  // 动态导入 polyfill
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

// 全局错误处理，给用户反馈
app.config.errorHandler = (
  err: unknown,
  instance: ComponentPublicInstance | null,
  info: string
): void => {
  logger.error('[Global Error]', err, info)
  // 性能埋点：Vue 渲染/生命周期错误计数（生产可见）
  perfReportError('vue')
  // 在开发环境显示详细错误，生产环境显示友好提示
  if (import.meta.env.DEV) {
    logger.error('错误详情:', { err, instance, info })
  } else {
    // 错误上报接入路径（按 D-15=A 决策，暂缓接入，仅文档化）。
    // logger 已预留 addLogTransport 钩子（见 shared/utils/logger.ts），Sentry 账号 + DSN
    // 就绪后按以下步骤一行接入，无需改动业务代码：
    // 1) 安装依赖：npm i @sentry/vue
    // 2) import * as Sentry from '@sentry/vue'
    // 3) 在 app.mount('#app') 之前调用：
    // Sentry.init({ app, dsn: '<DSN>', release: __APP_VERSION__, environment: import.meta.env.MODE })
    // 4) 接入 transport（一行）：
    // logger.addLogTransport((entry) =>
    // Sentry.captureMessage(`[${entry.level}] ${entry.args.map(String).join(' ')}`))
  }
}

// 窗口级兜底——捕获未被 Vue errorHandler 覆盖的错误
window.onerror = (message, source, lineno, colno, error) => {
  logger.error('[window.onerror]', { message, source, lineno, colno, error })
  perfReportError('script')
}
window.onunhandledrejection = (event: PromiseRejectionEvent) => {
  logger.error('[unhandledrejection]', event.reason)
  perfReportError('promise')
}

app.mount('#app')
