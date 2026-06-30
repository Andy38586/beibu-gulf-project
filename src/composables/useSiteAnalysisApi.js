/**
 * @typedef {import('@/types/analysis').AnalysisParams} AnalysisParams
 * @typedef {import('@/types/analysis').AnalysisResult} AnalysisResult
 */

import { ref } from 'vue'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

/**
 * 选址分析 API 相关的 composable
 * @returns {{
 *   analyze: (params: AnalysisParams) => Promise<AnalysisResult>,
 *   calculating: import('vue').Ref<boolean>,
 *   calcError: import('vue').Ref<string>
 * }}
 */
export function useSiteAnalysisApi() {
  /** @type {import('vue').Ref<boolean>} */
  const calculating = ref(false)
  /** @type {import('vue').Ref<string>} */
  const calcError = ref('')

  /**
   * 执行选址分析
   * @param {AnalysisParams} params - 分析参数
   * @returns {Promise<AnalysisResult>} - 分析结果
   */
  async function analyze({ selectedKeys, typeSettings, weights }) {
    calcError.value = ''
    calculating.value = true
    try {
      const res = await fetch(`${API_BASE}/site-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedKeys, typeSettings, weights }),
      })
      if (!res.ok) throw new Error(`分析请求失败 HTTP ${res.status}`)

      /** @type {AnalysisResult} */
      const result = await res.json()
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
