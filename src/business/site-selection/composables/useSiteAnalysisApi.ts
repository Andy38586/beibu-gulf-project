import { ref } from 'vue'
import type { Ref } from 'vue'
import type { AnalysisParams, AnalysisResult } from '@/types/analysis'
import { useApiRequest } from '@/shared/composables/useApiRequest'

export function useSiteAnalysisApi() {
  const { apiRequest } = useApiRequest()
  const calculating: Ref<boolean> = ref(false)
  const calcError: Ref<string> = ref('')

  async function analyze(params: AnalysisParams): Promise<AnalysisResult> {
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
      // AUDIT-008: 区分不同HTTP错误状态码
      if (error instanceof Error) {
        if (error.message.includes('400')) {
          calcError.value = '参数错误，请检查输入'
        } else if (error.message.includes('401')) {
          calcError.value = '请先登录'
        } else if (error.message.includes('500')) {
          calcError.value = '服务器错误，请稍后重试'
        } else if (error.message.includes('超时')) {
          calcError.value = '请求超时，请稍后重试'
        } else {
          calcError.value = '网络异常，请稍后重试'
        }
      } else {
        calcError.value = '网络异常，请稍后重试'
      }
      return { error: calcError.value, coverage: null, matchedXiaoqu: [] }
    } finally {
      calculating.value = false
    }
  }

  return { analyze, calculating, calcError }
}
