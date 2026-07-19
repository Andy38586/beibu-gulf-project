import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './style.css'

// AUDIT-316: ResizeObserver polyfill for Safari < 13.1
if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
  // 动态导入 polyfill
  import('resize-observer-polyfill').then(({ default: ResizeObserverPolyfill }) => {
    window.ResizeObserver = ResizeObserverPolyfill
  }).catch(() => {
    console.warn('ResizeObserver polyfill 加载失败，部分响应式布局可能不可用')
  })
}

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(ElementPlus)

// AUDIT-014 (错误): 全局错误处理，给用户反馈
app.config.errorHandler = (err, instance, info) => {
  console.error('[Global Error]', err, info)
  // 在开发环境显示详细错误，生产环境显示友好提示
  if (import.meta.env.DEV) {
    console.error('错误详情:', { err, instance, info })
  } else {
    // 可以集成错误上报服务（如 Sentry）
    // reportErrorToService(err, info)
  }
}

app.mount('#app')
