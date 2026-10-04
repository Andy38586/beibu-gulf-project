/**
 * diversionAdapter — 分流分析数据适配器（W10-11）：
 * GET /diversion/breakdown?year= 与 GET /diversion/canal-line，
 * HTTP 边界 zod 校验（diversionBreakdownResponseSchema / canalLineResponseSchema）。
 */
import { ENDPOINTS, useApiRequest } from '@/shared'
import type { CanalLineResponseParsed, DiversionBreakdownResponseParsed } from '@/types/schemas'
import { canalLineResponseSchema, diversionBreakdownResponseSchema } from '@/types/schemas'

const { apiRequest } = useApiRequest()

export type DiversionResult = DiversionBreakdownResponseParsed
type CanalLineResult = CanalLineResponseParsed

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

  /** 运河线位（示意线/真线位；弧线图层几何底座，权威源 = 权威库 canal 表） */
  async getCanalLine(signal?: AbortSignal): Promise<CanalLineResult> {
    return apiRequest<CanalLineResult>(ENDPOINTS.diversion.canalLine, {
      method: 'GET',
      signal,
      schema: canalLineResponseSchema,
    })
  },
}
