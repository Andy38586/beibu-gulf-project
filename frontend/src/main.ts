import './style.css'
// Element Plus 暗色主题变量（html.dark 钩子由 useTheme 同步切换；按需引入组件不含 dark 变量）
import 'element-plus/theme-chalk/dark/css-vars.css'
import { createPinia } from 'pinia'
import type { ComponentPublicInstance } from 'vue'
import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import { floodAdapter } from './services/adapters/floodAdapter'
import { useTheme } from './shared'
import { logger } from './shared/utils/logger'
import { initPerfReporter, perfReportError } from './shared/utils/perfReporter'

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

// 尽早挂载性能观察者，捕获 FCP/LCP/TTI/longtask（dev-only，不进生产包）
initPerfReporter()

// 数据源由环境变量驱动，默认 api（生产安全）；flood 保留双模式：api（Express 后端）/ online（FastAPI 实时演算）
const dataSource = (import.meta.env.VITE_DATA_SOURCE as 'api' | 'online' | undefined) || 'api'
floodAdapter.setDataSource(dataSource)

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
  // 开发环境显示详细错误，生产环境显示友好提示
  if (import.meta.env.DEV) {
    logger.error('错误详情:', { err, instance, info })
  } else {
    // 错误上报暂缓接入：logger 已预留 addLogTransport 钩子（见 shared/utils/logger.ts），Sentry 就绪后一行接入即可
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
