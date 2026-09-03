import type { Ref } from 'vue'
import { ref } from 'vue'

import { ENDPOINTS, useApiRequest, useLatestRequest } from '@/shared'
import type { RoutePathParams, RoutePathResponse } from '@/types'
import { routePathResponseSchema } from '@/types/schemas'

/** 返回契约（显式化，防重构时签名静默漂移，对齐 useSiteAnalysisApi 同款声明） */
export interface UseRouteApiReturn {
  /** 查询路径：返回 backend 结果（found true/false 均为合法响应）；
   *  网络/503/schema 校验失败时 throw（调用方区分错误态与业务空态） */
  queryPath: (params: RoutePathParams) => Promise<RoutePathResponse>
  /** 请求进行中（竞态守卫：快速连点只保留最新一次） */
  calculating: Ref<boolean>
  /** 最近一次请求错误文案（'' = 无错），供面板展示 */
  calcError: Ref<string>
  /** 取消在途请求并复位加载态（供调用方 onUnmounted 调用） */
  cancel: () => void
}

export function useRouteApi(): UseRouteApiReturn {
  const { apiRequest } = useApiRequest()
  const { createSignal, isLatest, cancel: cancelRequest } = useLatestRequest()
  const calculating = ref(false)
  const calcError = ref('')

  async function queryPath(params: RoutePathParams): Promise<RoutePathResponse> {
    // 新请求优先——取消上一个在途请求（起终点/模式连点场景用户期望最新结果）
    const signal = createSignal()
    calcError.value = ''
    calculating.value = true
    try {
      // FastAPI 裸 JSON（envelope:false）+ zod 判别校验；/flood-online 前缀不叠加
      return await apiRequest<RoutePathResponse>(ENDPOINTS.route.path, {
        method: 'GET',
        // params 需要索引签名，RoutePathParams 是具名接口——显式转 Record（对齐 useSiteAnalysisApi 传法）
        params: { ...params } as Record<string, string | number | boolean | undefined>,
        signal,
        envelope: false,
        schema: routePathResponseSchema,
      })
    } catch (error) {
      if (signal.aborted) {
        // 主动取消（新请求抢占 / 组件卸载）— 静默，不写错误
        return { found: false, reason: 'unreachable' }
      }
      const msg = error instanceof Error ? error.message : '路径查询失败，请稍后重试'
      calcError.value = msg
      throw error
    } finally {
      if (isLatest(signal)) calculating.value = false
    }
  }

  /** 取消在途请求并复位加载态（供调用方 onUnmounted 调用） */
  function cancel(): void {
    cancelRequest()
    calculating.value = false
  }

  return { queryPath, calculating, calcError, cancel }
}
