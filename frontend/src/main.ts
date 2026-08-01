import './style.css'
import { createPinia } from 'pinia'
import type { ComponentPublicInstance } from 'vue'
import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import { floodAdapter } from './services/adapters/floodAdapter'
import { forecastAdapter } from './services/adapters/forecastAdapter'
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

// b024: 数据源由环境变量驱动，默认 mock，生产部署时设 VITE_DATA_SOURCE=api
const dataSource = (import.meta.env.VITE_DATA_SOURCE as 'mock' | 'api') || 'mock'
// 预测分析：真实指标（cargo/container）走后端 API；合成指标（berth/traffic）由 adapter
// 按 INDICATOR_SOURCE 回退到前端静态 fixture（public/data/forecast/*）。全局默认设为 'api'。
forecastAdapter.setDataSource('api')
floodAdapter.setDataSource(dataSource)

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
  // 在开发环境显示详细错误，生产环境显示友好提示
  if (import.meta.env.DEV) {
    logger.error('错误详情:', { err, instance, info })
  } else {
    // 可以集成错误上报服务（如 Sentry）
    // reportErrorToService(err, info)
  }
}

// z029: 窗口级兖底——捕获未被 Vue errorHandler 覆盖的错误
window.onerror = (message, source, lineno, colno, error) => {
  logger.error('[window.onerror]', { message, source, lineno, colno, error })
}
window.onunhandledrejection = (event: PromiseRejectionEvent) => {
  logger.error('[unhandledrejection]', event.reason)
}

app.mount('#app')
