/**
 * diversionAdapter — 分流分析数据适配器（W10-11）：
 * GET /diversion/breakdown?year=，HTTP 边界 zod 校验（diversionBreakdownResponseSchema）。
 */
import { ENDPOINTS, useApiRequest } from '@/shared'
import type { DiversionBreakdownResponseParsed } from '@/types/schemas'
import { diversionBreakdownResponseSchema } from '@/types/schemas'

const { apiRequest } = useApiRequest()

export type DiversionResult = DiversionBreakdownResponseParsed

export const diversionAdapter = {
  /** 分流分解（桑基流 + 分货类转移 + 三港分摊） */
  async getBreakdown(year: number, signal?: AbortSignal): Promise<DiversionResult> {
    return apiRequest<DiversionResult>(ENDPOINTS.diversion.breakdown, {
      method: 'GET',
      params: { year },
      signal,
      schema: diversionBreakdownResponseSchema,
    })
  },
}
