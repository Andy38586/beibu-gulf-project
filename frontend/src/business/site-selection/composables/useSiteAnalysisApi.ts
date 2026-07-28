import { ref } from 'vue'
import type { Ref } from 'vue'
import type { AnalysisParams, AnalysisResult } from '@/types/analysis'
import { useApiRequest, ApiError, ErrorCode } from '@/shared/composables/useApiRequest'
import { logger } from '@/shared/utils/logger'

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
      // 用错误码分派，避免字符串匹配
      if (error instanceof ApiError) {
        switch (error.code) {
          case ErrorCode.TIMEOUT:
            calcError.value = '选址分析请求超时，请检查网络后重试'
            break
          case ErrorCode.UNAUTHORIZED:
            calcError.value = '请先登录后再进行分析'
            break
          case ErrorCode.SERVER_ERROR:
            calcError.value = '选址分析服务异常，请稍后重试'
            break
          case ErrorCode.NETWORK_ERROR:
            calcError.value = '选址分析网络异常，请检查连接'
            break
          case ErrorCode.REQUEST_FAILED:
            calcError.value = '选址分析参数异常，请调整筛选条件后重试'
            break
          default:
            calcError.value = '选址分析失败，请稍后重试'
        }
      } else {
        calcError.value = '选址分析网络异常，请稍后重试'
      }
      return { error: calcError.value, coverage: null, matchedXiaoqu: [], facilityPoi: {} }
    } finally {
      calculating.value = false
    }
  }

  return { analyze, calculating, calcError }
}
