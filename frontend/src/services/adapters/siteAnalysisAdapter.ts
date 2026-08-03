/**
 * Site Analysis Data Adapter
 * 职责：隔离选址分析业务层与数据源（a021 补齐,与 forecastAdapter/floodAdapter 同构）。
 * 业务层（useSiteAnalysisApi）通过此 Adapter 获取数据,无需关心数据来自 Mock 还是真实 API。
 *
 * 当前实现：仅 api 模式（后端 POST /site-analysis）。mock 分支按需后补——
 * 与 flood/forecast 的"mock 契约桩"定位一致后,再添加 mock 数据源。
 */

import { useApiRequest } from '@/shared'
import type { AnalysisParams, AnalysisResult } from '@/types/analysis'
import { siteAnalysisResponseSchema } from '@/types/schemas'

import { resolveDataSource, setAdapterDataSource } from '../dataSourceConfig'

const ADAPTER_NAME = 'site-analysis'

const { apiRequest } = useApiRequest()

export const siteAnalysisAdapter = {
  get dataSource(): string {
    return resolveDataSource(ADAPTER_NAME)
  },

  setDataSource(mode: 'mock' | 'api'): void {
    setAdapterDataSource(ADAPTER_NAME, mode)
  },

  /** 执行选址分析（POST,统一入口 useApiRequest,信封自动解包 + zod 校验） */
  async analyze(params: AnalysisParams, signal?: AbortSignal): Promise<AnalysisResult> {
    return apiRequest<AnalysisResult>('/site-analysis', {
      method: 'POST',
      body: JSON.stringify(params),
      signal,
      schema: siteAnalysisResponseSchema,
    })
  },
}
