/**
 * useTheme - 全局主题（亮色/暗色）模块级单例
 * 唯一事实源：localStorage 持久化 + prefers-color-scheme 兜底；
 * 应用方式：documentElement.dataset.theme，CSS 变量覆盖见 style.css。
 * 非 CSS 消费者（ECharts canvas 不支持 CSS 变量）经 onThemeChange 订阅重设；
 * 切换为单帧重绘、连点幂等，无需防抖。
 */
import { computed, readonly, ref } from 'vue'

export type ThemeMode = 'light' | 'dark'

const THEME_STORAGE_KEY = 'gcs-theme'

/** 安全访问 localStorage（jsdom 环境无 Storage 方法，降级为 null） */
function safeStorage(): Storage | null {
  try {
    const ls = typeof window !== 'undefined' ? window.localStorage : null
    return ls && typeof ls.getItem === 'function' ? ls : null
  } catch {
    return null
  }
}

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  const saved = safeStorage()?.getItem(THEME_STORAGE_KEY)
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const theme = ref<ThemeMode>(getInitialTheme())

const listeners = new Set<(mode: ThemeMode) => void>()

function applyTheme(mode: ThemeMode): void {
  theme.value = mode
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = mode
    // Element Plus 暗色联动：EP 的暗色变量挂在 html.dark class（自定义 data-theme 只管业务 CSS）
    document.documentElement.classList.toggle('dark', mode === 'dark')
  }
  safeStorage()?.setItem(THEME_STORAGE_KEY, mode)
  listeners.forEach((cb) => cb(mode))
}

export function useTheme() {
  /** 应用初始主题（mount 前调用，避免首帧闪白/闪黑） */
  function initTheme(): void {
    applyTheme(theme.value)
  }

  /** 切换亮/暗（图标显示另一侧，由消费方决定） */
  function toggleTheme(): void {
    applyTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  /** 订阅主题变化（ECharts 等 canvas 消费者）；返回取消函数 */
  function onThemeChange(cb: (mode: ThemeMode) => void): () => void {
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  }

  return {
    theme: readonly(theme),
    isDark: computed(() => theme.value === 'dark'),
    initTheme,
    toggleTheme,
    onThemeChange,
  }
}
