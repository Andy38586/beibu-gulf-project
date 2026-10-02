/**
 * siteSuitabilityAdapter — 新选址分析数据适配器（单元五）：
 * GET /site-suitability/map，权重与过滤参数透传，HTTP 边界 zod 校验
 * （siteSuitabilityResponseSchema，@backend-contract 反向核对已挂）。
 */
import { ENDPOINTS, useApiRequest } from '@/shared'
import type { SiteSuitabilityResponseParsed } from '@/types/schemas'
import { siteSuitabilityResponseSchema } from '@/types/schemas'

const { apiRequest } = useApiRequest()

export interface SuitabilityMapParams {
  /** 五准则权重（和=1，由 store.normalizedWeights() 保证） */
  weights: Record<string, number>
  /** 最小陆像元占比过滤 */
  minLandFrac: number
}

export interface SuitabilityMapResult {
  features: SiteSuitabilityResponseParsed['features']
  metadata: SiteSuitabilityResponseParsed['metadata']
}

export const siteSuitabilityAdapter = {
  /** 加权叠加格网（GeoJSON 点集，properties.score 供热力渲染） */
  async getMap(params: SuitabilityMapParams, signal?: AbortSignal): Promise<SuitabilityMapResult> {
    const weightParams = Object.fromEntries(
      Object.entries(params.weights).map(([k, v]) => [`w_${k}`, v])
    )
    const data = await apiRequest<SiteSuitabilityResponseParsed>(ENDPOINTS.siteSuitability.map, {
      method: 'GET',
      params: { ...weightParams, min_land_frac: params.minLandFrac },
      signal,
      schema: siteSuitabilityResponseSchema,
    })
    return { features: data.features, metadata: data.metadata }
  },
}
