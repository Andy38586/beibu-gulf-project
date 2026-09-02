/**
 * useTheme - 全局主题（亮色/暗色）模块级单例
 * 唯一事实源：localStorage 持久化 + prefers-color-scheme 兜底；
 * 应用方式：documentElement.dataset.theme，CSS 变量覆盖见 style.css。
 * 非 CSS 消费者（ECharts canvas 不支持 CSS 变量）经 onThemeChange 订阅重设；
 * 切换为单帧重绘、连点幂等，无需防抖。
 */
import { computed, type ComputedRef, readonly, type Ref, ref } from 'vue'

import { getSafeStorage } from '@/shared/utils/safeStorage'

export type ThemeMode = 'light' | 'dark'

/** 返回契约（816-专项3-0816-13：显式化，防重构时签名静默漂移） */
export interface UseThemeReturn {
  theme: Readonly<Ref<ThemeMode>>
  isDark: ComputedRef<boolean>
  initTheme: () => void
  toggleTheme: () => void
  onThemeChange: (cb: (mode: ThemeMode) => void) => () => void
}

const THEME_STORAGE_KEY = 'gcs-theme'

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  const saved = getSafeStorage()?.getItem(THEME_STORAGE_KEY)
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const theme = ref<ThemeMode>(getInitialTheme())

const listeners = new Set<(mode: ThemeMode) => void>()

function applyTheme(mode: ThemeMode, persist = true): void {
  theme.value = mode
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = mode
    // Element Plus 暗色联动：EP 的暗色变量挂在 html.dark class（自定义 data-theme 只管业务 CSS）
    document.documentElement.classList.toggle('dark', mode === 'dark')
  }
  if (persist) getSafeStorage()?.setItem(THEME_STORAGE_KEY, mode)
  listeners.forEach((cb) => cb(mode))
}

// 816-专项7 S7-36：系统主题变化实时跟随——仅当用户未手动选择（localStorage 无 gcs-theme）时生效；
// 跟随系统应用不落盘（persist=false），保证手动切换后置手动优先位
function watchSystemTheme(): void {
  if (typeof window === 'undefined' || !window.matchMedia) return
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', (e) => {
    if (!getSafeStorage()?.getItem(THEME_STORAGE_KEY)) {
      applyTheme(e.matches ? 'dark' : 'light', false)
    }
  })
}
watchSystemTheme()

export function useTheme(): UseThemeReturn {
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
