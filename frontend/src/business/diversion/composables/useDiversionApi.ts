import { ENDPOINTS, useApiRequest } from '@/shared'
import type { CanalLineResponseParsed, DiversionBreakdownResponseParsed } from '@/types/schemas'
import { canalLineResponseSchema, diversionBreakdownResponseSchema } from '@/types/schemas'

/** 分流分析取数（业务专属，单消费页 DiversionPage）：HTTP 边界 zod 校验 */
export function useDiversionApi() {
  const { apiRequest } = useApiRequest()

  async function getBreakdown(
    year: number,
    signal?: AbortSignal
  ): Promise<DiversionBreakdownResponseParsed> {
    return apiRequest<DiversionBreakdownResponseParsed>(ENDPOINTS.diversion.breakdown, {
      method: 'GET',
      params: { year },
      signal,
      schema: diversionBreakdownResponseSchema,
    })
  }

  async function getCanalLine(signal?: AbortSignal): Promise<CanalLineResponseParsed> {
    return apiRequest<CanalLineResponseParsed>(ENDPOINTS.diversion.canalLine, {
      method: 'GET',
      signal,
      schema: canalLineResponseSchema,
    })
  }

  return { getBreakdown, getCanalLine }
}
