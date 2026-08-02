import type { Ref } from 'vue'
import { ref } from 'vue'

import { useApiRequest } from '@/shared/composables/useApiRequest'
import { handleAuthError, isAuthError, showError } from '@/shared/utils/errorHandler'
import { logger } from '@/shared/utils/logger'
import type { AnalysisParams, AnalysisResult } from '@/types/analysis'

export function useSiteAnalysisApi() {
  const { apiRequest } = useApiRequest()
  const calculating: Ref<boolean> = ref(false)
  const calcError: Ref<string> = ref('')

  async function analyze(params: AnalysisParams): Promise<AnalysisResult> {
    // 请求去重，防止重复提交
    if (calculating.value) {
      if (import.meta.env.DEV) {
        logger.warn('[useSiteAnalysisApi] 分析请求已在进行中，忽略重复请求')
      }
      return { error: '正在分析中，请稍后再试', coverage: null, matchedXiaoqu: [], facilityPoi: {} }
    }

    calcError.value = ''
    calculating.value = true
    try {
      const result = await apiRequest<AnalysisResult>('/site-analysis', {
        method: 'POST',
        body: JSON.stringify(params),
      })
      if (result.error) {
        calcError.value = result.error
        return {
          error: result.error,
          coverage: null,
          matchedXiaoqu: [],
          facilityPoi: {},
        }
      }
      return {
        error: null,
        coverage: result.coverage || null,
        matchedXiaoqu: result.matchedXiaoqu || [],
        facilityPoi: result.facilityPoi || {},
      }
    } catch (error) {
      // 401：site-analysis 整路由需登录，走统一软登录（与 forecast 侧一致）
      if (isAuthError(error)) {
        await handleAuthError()
      }
      // z031: 统一走 errorHandler，消除手写 switch 与全站口径不一致
      showError(error, { fallback: '选址分析失败，请稍后重试' })
      calcError.value = error instanceof Error ? error.message : '选址分析失败，请稍后重试'
      return { error: calcError.value, coverage: null, matchedXiaoqu: [], facilityPoi: {} }
    } finally {
      calculating.value = false
    }
  }

  return { analyze, calculating, calcError }
}
