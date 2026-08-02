/**
 * useAsyncData — 通用异步数据管理（z034）
 *
 * 封装 loading/error/data/refresh/cancel 五元组，
 * 消除 Forecast/Flood/SiteSelection 各自维护竞态/取消的重复代码。
 *
 * 仅复杂业务页使用；简单页保持 onMounted 直接调用（D-4 克制）。
 *
 * @audit-note DAT-4 预留未接入：当前无调用方，作为通用工具保留，请勿删除
 */
import type { Ref, ShallowRef } from 'vue'
import { ref, shallowRef } from 'vue'

import { logger } from '@/shared/utils/logger'

export interface UseAsyncDataReturn<T> {
  data: ShallowRef<T | null>
  loading: Ref<boolean>
  error: Ref<string>
  /** 重新执行（自动取消上一次未完成请求） */
  refresh: (...args: unknown[]) => Promise<void>
  /** 手动取消当前请求 */
  cancel: () => void
}

interface UseAsyncDataOptions {
  /** 是否立即执行（默认 true） */
  immediate?: boolean
  /** 错误兜底文案 */
  fallback?: string
}

export function useAsyncData<T>(
  fn: (signal: AbortSignal, ...args: unknown[]) => Promise<T>,
  options: UseAsyncDataOptions = {}
): UseAsyncDataReturn<T> {
  const { immediate = true, fallback = '数据加载失败，请稍后重试' } = options

  const data: ShallowRef<T | null> = shallowRef(null)
  const loading = ref(false)
  const error = ref('')

  let abortController: AbortController | null = null
  // 事务序号：仅最新请求的响应写入 data，防止竞态
  let seq = 0

  function cancel(): void {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  async function refresh(...args: unknown[]): Promise<void> {
    // 取消上一次未完成请求
    cancel()

    const controller = new AbortController()
    abortController = controller
    const currentSeq = ++seq

    loading.value = true
    error.value = ''

    try {
      const result = await fn(controller.signal, ...args)
      // 竞态守卫：仅最新请求写入
      if (currentSeq !== seq) return
      data.value = result
    } catch (e) {
      if (currentSeq !== seq) return
      // 用户主动取消不报错
      if (e instanceof Error && e.name === 'AbortError') return
      const msg = e instanceof Error ? e.message : fallback
      error.value = msg
      logger.warn('[useAsyncData]', msg)
    } finally {
      if (currentSeq === seq) {
        loading.value = false
      }
    }
  }

  if (immediate) {
    refresh()
  }

  return { data, loading, error, refresh, cancel }
}
