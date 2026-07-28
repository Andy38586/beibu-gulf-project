import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { createPinia } from 'pinia'
import './style.css'
import { logger } from './shared/utils/logger'

/**
 * 启动时校验关键环境变量
 * 缺失非必需变量时告警但不阻断启动，缺失必需变量时报错
 */
function validateEnv() {
  const warnings = []
  const errors = []

  // 必需：天地图 KEY（无 KEY 地图底图无法加载）
  if (!import.meta.env.VITE_TIANDITU_KEY) {
    errors.push('VITE_TIANDITU_KEY 缺失：地图底图无法加载，请在 .env 文件中配置')
  }

  // 非必需：API 基础路径（有 fallback '/api'）
  if (!import.meta.env.VITE_API_BASE) {
    warnings.push('VITE_API_BASE 未配置，使用默认值 /api')
  }

  warnings.forEach((msg) => logger.warn(`[env] ${msg}`))
  errors.forEach((msg) => logger.error(`[env] ${msg}`))
}

validateEnv()

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
app.config.errorHandler = (err, instance, info) => {
  logger.error('[Global Error]', err, info)
  // 在开发环境显示详细错误，生产环境显示友好提示
  if (import.meta.env.DEV) {
    logger.error('错误详情:', { err, instance, info })
  } else {
    // 可以集成错误上报服务（如 Sentry）
    // reportErrorToService(err, info)
  }
}

app.mount('#app')
