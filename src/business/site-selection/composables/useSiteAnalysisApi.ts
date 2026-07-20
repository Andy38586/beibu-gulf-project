import { ref } from 'vue'
import type { Ref } from 'vue'
import type { AnalysisParams, AnalysisResult } from '@/types/analysis'
import { useApiRequest, ApiError, ErrorCode } from '@/shared/composables/useApiRequest'

export function useSiteAnalysisApi() {
  const { apiRequest } = useApiRequest()
  const calculating: Ref<boolean> = ref(false)
  const calcError: Ref<string> = ref('')

  async function analyze(params: AnalysisParams): Promise<AnalysisResult> {
    // AUDIT-P03: 请求去重，防止重复提交
    if (calculating.value) {
      if (import.meta.env.DEV) {
        console.warn('[useSiteAnalysisApi] 分析请求已在进行中，忽略重复请求')
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
        // AUDIT-009: 返回完整的错误对象结构
        return { 
          error: result.error, 
          coverage: null, 
          matchedXiaoqu: [],
          facilityPoi: {}
        }
      }
      // AUDIT-009: 确保返回对象结构完整
      return {
        error: null,
        coverage: result.coverage || null,
        matchedXiaoqu: result.matchedXiaoqu || [],
        facilityPoi: result.facilityPoi || {}
      }
    } catch (error) {
      // P3-002-FIX: 使用错误码替代字符串匹配，提高可维护性
      if (error instanceof ApiError) {
        switch (error.code) {
          case ErrorCode.TIMEOUT:
            calcError.value = '请求超时，请稍后重试'
            break
          case ErrorCode.UNAUTHORIZED:
            calcError.value = '请先登录'
            break
          case ErrorCode.SERVER_ERROR:
            calcError.value = '服务器错误，请稍后重试'
            break
          case ErrorCode.NETWORK_ERROR:
            calcError.value = '网络异常，请检查网络连接'
            break
          case ErrorCode.REQUEST_FAILED:
            calcError.value = '参数错误，请检查输入'
            break
          default:
            calcError.value = '网络异常，请稍后重试'
        }
      } else {
        calcError.value = '网络异常，请稍后重试'
      }
      // AUDIT-009: 保持返回结构完整
      return { error: calcError.value, coverage: null, matchedXiaoqu: [], facilityPoi: {} }
    } finally {
      calculating.value = false
    }
  }

  return { analyze, calculating, calcError }
}
