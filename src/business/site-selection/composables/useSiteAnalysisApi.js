/**
 * @typedef {import('@/types/analysis').AnalysisParams} AnalysisParams
 * @typedef {import('@/types/analysis').AnalysisResult} AnalysisResult
 */

import { ref } from 'vue'
import { useApiRequest } from '@/shared/composables/useApiRequest'

export function useSiteAnalysisApi() {
  const { apiRequest } = useApiRequest()
  /** @type {import('vue').Ref<boolean>} */
  const calculating = ref(false)
  /** @type {import('vue').Ref<string>} */
  const calcError = ref('')

  async function analyze({ selectedKeys, typeSettings, weights }) {
    calcError.value = ''
    calculating.value = true
    try {
      /** @type {AnalysisResult} */
      const result = await apiRequest('/site-analysis', {
        method: 'POST',
        body: JSON.stringify({ selectedKeys, typeSettings, weights }),
      })
      if (result.error) {
        calcError.value = result.error
        return { coverage: null, matchedXiaoqu: [], selectedTypes: [] }
      }
      return result
    } catch (error) {
      console.error('选址分析请求失败:', error)
      calcError.value = '网络异常，请稍后重试'
      return { coverage: null, matchedXiaoqu: [], selectedTypes: [] }
    } finally {
      calculating.value = false
    }
  }

  return { analyze, calculating, calcError }
}
