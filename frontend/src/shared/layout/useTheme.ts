/**
 * useTheme - 全局主题（亮色 / 暗色）模块级单例
 * 职责：
 * - 主题状态唯一事实源（localStorage 持久化 + prefers-color-scheme 兜底）
 * - 应用方式：document.documentElement.dataset.theme —— CSS 变量覆盖见 style.css
 *   `:root[data-theme='dark']`（白→深蓝、蓝→高饱和橙，2026-08-10）
 * - 非 CSS 消费者（ECharts canvas 不支持 CSS 变量）经 onThemeChange 订阅重设
 * 性能说明：
 * - 切换 = 一次性 CSS 变量重算 + 单帧重绘（毫秒级），非动画无持续消耗，
 *   快速连点幂等无害，不加限流/防抖；ECharts 重设由 useECharts 内部 100ms 防抖合并
 */
import { computed, readonly, ref } from 'vue'

export type ThemeMode = 'light' | 'dark'

const THEME_STORAGE_KEY = 'gcs-theme'

/** 安全访问 localStorage（jsdom 的 localStorage 是空对象无 Storage 方法，判空降级为 null） */
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
  }
  safeStorage()?.setItem(THEME_STORAGE_KEY, mode)
  listeners.forEach((cb) => cb(mode))
}

export function useTheme() {
  /** 应用初始主题（main.ts mount 前调用，避免首帧闪白/闪黑） */
  function initTheme(): void {
    applyTheme(theme.value)
  }

  /** 切换亮/暗（按钮语义：显示当前模式的另一侧，图标由消费方决定） */
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
