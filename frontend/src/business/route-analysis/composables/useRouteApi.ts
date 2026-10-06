import { ENDPOINTS, useApiRequest } from '@/shared'
import type { PoiSearchItemParsed } from '@/types/schemas'
import { poiSearchResponseSchema } from '@/types/schemas'

/** 返回契约（显式化，防重构时签名静默漂移） */
interface UseRouteApiReturn {
  /** 名称关键词搜索（选点辅助）：服务端多源点集合并（港口/淹没设施点/小区/POI），limit 1..200；
   *  signal 供调用方卸载/抢占取消（审查 M-6：挂载兜底请求此前不可取消） */
  searchPois: (
    keyword: string,
    limit?: number,
    signal?: AbortSignal
  ) => Promise<PoiSearchItemParsed[]>
}

export function useRouteApi(): UseRouteApiReturn {
  const { apiRequest } = useApiRequest()

  /** 名称关键词搜索（选点辅助）：keyword 空返回兜底列表；limit 服务端钳制 1..200 */
  async function searchPois(
    keyword: string,
    limit = 50,
    signal?: AbortSignal
  ): Promise<PoiSearchItemParsed[]> {
    return apiRequest<PoiSearchItemParsed[]>(ENDPOINTS.route.pois, {
      params: { keyword: keyword || undefined, limit },
      schema: poiSearchResponseSchema,
      signal,
    })
  }

  return { searchPois }
}
