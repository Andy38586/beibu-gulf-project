import type { Ref } from 'vue'
import { ref } from 'vue'

import { ENDPOINTS, useApiRequest, useLatestRequest } from '@/shared'
import type { RoutePathParams, RoutePathResponse } from '@/types'
import type { PoiSearchItemParsed } from '@/types/schemas'
import { poiSearchResponseSchema, routePathResponseSchema } from '@/types/schemas'

/** 请求被取消（新请求抢占/组件卸载）的显式标记——取消不是业务失败，
 * 必须与「不可达」真实空结果区分，调用方对它静默不更新 UI */
export class RouteQueryCancelledError extends Error {
  constructor() {
    super('路径查询已取消')
    this.name = 'RouteQueryCancelledError'
  }
}

/** 返回契约（显式化，防重构时签名静默漂移，对齐 useSiteAnalysisApi 同款声明） */
export interface UseRouteApiReturn {
  /** 查询路径：返回 backend 结果（found true/false 均为合法响应）；
   *  网络/503/schema 校验失败时 throw；请求被取消 throw RouteQueryCancelledError
   *  （调用方区分错误态、业务空态与取消态） */
  queryPath: (params: RoutePathParams) => Promise<RoutePathResponse>
  /** 请求进行中（竞态守卫：快速连点只保留最新一次） */
  calculating: Ref<boolean>
  /** 最近一次请求错误文案（'' = 无错），供面板展示 */
  calcError: Ref<string>
  /** 取消在途请求并复位加载态（供调用方 onUnmounted 调用） */
  cancel: () => void
  /** POI 名称关键词搜索（选点辅助，Nest PG poi_facilities 全类型） */
  searchPois: (keyword: string, limit?: number) => Promise<PoiSearchItemParsed[]>
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
        // 主动取消（新请求抢占/组件卸载）——抛显式取消错误而非伪造 unreachable
        // 业务空结果（旧实现会把取消伪装成「路网断链」触发误告警/闪图层）
        throw new RouteQueryCancelledError()
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

  /** POI 名称关键词搜索（选点辅助）：keyword 空返回兜底列表；limit 服务端钳制 1..50 */
  async function searchPois(keyword: string, limit = 30): Promise<PoiSearchItemParsed[]> {
    return apiRequest<PoiSearchItemParsed[]>(ENDPOINTS.siteAnalysis.pois, {
      params: { keyword: keyword || undefined, limit },
      schema: poiSearchResponseSchema,
    })
  }

  return { queryPath, calculating, calcError, cancel, searchPois }
}
