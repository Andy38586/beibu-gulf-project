import type { Ref } from 'vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { useApiRequest } from '@/shared/composables/useApiRequest'
import { handleAuthError, isAuthError, showError } from '@/shared/utils/errorHandler'
import type { AnalysisParams, AnalysisResult } from '@/types/analysis'

export function useSiteAnalysisApi() {
  const router = useRouter()
  const { apiRequest } = useApiRequest()
  const calculating: Ref<boolean> = ref(false)
  const calcError: Ref<string> = ref('')
  // b041: 在途请求取消句柄；新请求优先取消旧请求，组件卸载时静默取消
  let abortController: AbortController | null = null

  async function analyze(params: AnalysisParams): Promise<AnalysisResult> {
    // b041: 新请求优先——取消上一个在途请求（快速连点用户期望看到最新结果）
    abortController?.abort()
    const controller = new AbortController()
    abortController = controller

    calcError.value = ''
    calculating.value = true
    try {
      const result = await apiRequest<AnalysisResult>('/site-analysis', {
        method: 'POST',
        body: JSON.stringify(params),
        signal: controller.signal,
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
      // b041: 主动取消（新请求抢占 / 组件卸载）— 静默返回，不弹错误、不触发软登录
      if (controller.signal.aborted) {
        return { error: null, coverage: null, matchedXiaoqu: [], facilityPoi: {} }
      }
      // 401：site-analysis 整路由需登录，走统一软登录（与 forecast 侧一致）
      if (isAuthError(error)) {
        await handleAuthError(router)
      }
      // z031: 统一走 errorHandler，消除手写 switch 与全站口径不一致
      showError(error, { fallback: '选址分析失败，请稍后重试' })
      calcError.value = error instanceof Error ? error.message : '选址分析失败，请稍后重试'
      return { error: calcError.value, coverage: null, matchedXiaoqu: [], facilityPoi: {} }
    } finally {
      calculating.value = false
    }
  }

  // b041: 取消在途请求并复位加载态（供调用方 onUnmounted 调用）
  function cancel(): void {
    abortController?.abort()
    abortController = null
    calculating.value = false
  }

  return { analyze, calculating, calcError, cancel }
}
