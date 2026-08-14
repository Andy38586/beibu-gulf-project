import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

import { handleAuthError, isAuthError, showError, useApiRequest, useLatestRequest } from '@/shared'
import { useSiteSelectionStore } from '@/stores'
import type { AnalysisParams, AnalysisResult } from '@/types/analysis'
import { siteAnalysisResponseSchema } from '@/types/schemas'

export function useSiteAnalysisApi() {
  const router = useRouter()
  // 选址分析仅 api 态（后端 POST /site-analysis），直连 useApiRequest（信封解包 + zod 校验）；
  // 竞态守卫统一走 useLatestRequest
  const { apiRequest } = useApiRequest()
  const { createSignal, cancel: cancelRequest } = useLatestRequest()
  // 请求进行态迁入 store（对齐 forecast），供页面与请求 composable 共享
  const siteStore = useSiteSelectionStore()
  const { calculating, calcError } = storeToRefs(siteStore)

  async function analyze(params: AnalysisParams): Promise<AnalysisResult> {
    // 新请求优先——取消上一个在途请求（快速连点用户期望看到最新结果）
    const signal = createSignal()

    calcError.value = ''
    calculating.value = true
    try {
      const result = await apiRequest<AnalysisResult>('/site-analysis', {
        method: 'POST',
        body: JSON.stringify(params),
        signal,
        schema: siteAnalysisResponseSchema,
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
      // 主动取消（新请求抢占 / 组件卸载）— 静默返回，不弹错误、不触发软登录
      if (signal.aborted) {
        return { error: null, coverage: null, matchedXiaoqu: [], facilityPoi: {} }
      }
      // 401：site-analysis 整路由需登录，走统一软登录（与 forecast 侧一致）
      if (isAuthError(error)) {
        await handleAuthError(router)
      }
      // 统一走 errorHandler，消除手写 switch 与全站口径不一致
      showError(error, { fallback: '选址分析失败，请稍后重试' })
      calcError.value = error instanceof Error ? error.message : '选址分析失败，请稍后重试'
      return { error: calcError.value, coverage: null, matchedXiaoqu: [], facilityPoi: {} }
    } finally {
      calculating.value = false
    }
  }

  // 取消在途请求并复位加载态（供调用方 onUnmounted 调用）
  function cancel(): void {
    cancelRequest()
    calculating.value = false
  }

  return { analyze, calculating, calcError, cancel }
}
