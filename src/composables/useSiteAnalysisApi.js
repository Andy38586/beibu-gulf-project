import { ref } from 'vue'

const API_BASE = 'http://localhost:3000/api'

export function useSiteAnalysisApi() {
  const calculating = ref(false)
  const calcError = ref('')

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

      const result = await res.json()
      if (result.error) {
        calcError.value = result.error
        return { coverage: null, matchedXiaoqu: [] }
      }
      return result
    } catch (error) {
      console.error('选址分析请求失败:', error)
      calcError.value = '网络异常，请稍后重试'
      return { coverage: null, matchedXiaoqu: [] }
    } finally {
      calculating.value = false
    }
  }

  return { analyze, calculating, calcError }
}
