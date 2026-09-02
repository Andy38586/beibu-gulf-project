import { storeToRefs } from 'pinia'
import type { Ref } from 'vue'

import { useApiRequest, useLatestRequest } from '@/shared'
import { useSiteSelectionStore } from '@/stores'
import type { AnalysisParams, AnalysisResult } from '@/types/analysis'
import { siteAnalysisResponseSchema } from '@/types/schemas'

/** 返回契约（816-专项3-0816-13：显式化，防重构时签名静默漂移） */
export interface UseSiteAnalysisApiReturn {
  analyze: (params: AnalysisParams) => Promise<AnalysisResult>
  calculating: Ref<boolean>
  calcError: Ref<string>
  cancel: () => void
}

export function useSiteAnalysisApi(): UseSiteAnalysisApiReturn {
  // 选址分析仅 api 态（后端 POST /site-analysis，免登录纯计算），直连 useApiRequest（信封解包 + zod 校验）；
  // 竞态守卫统一走 useLatestRequest
  const { apiRequest } = useApiRequest()
  const { createSignal, isLatest, cancel: cancelRequest } = useLatestRequest()
  // 请求进行态迁入 store（对齐 forecast），供页面与请求 composable 共享
  const siteStore = useSiteSelectionStore()
  const { calculating, calcError } = storeToRefs(siteStore)

  async function analyze(params: AnalysisParams): Promise<AnalysisResult> {
    // 新请求优先——取消上一个在途请求（快速连点用户期望看到最新结果）
    const signal = createSignal()

    // 状态写入口走 store action，禁止 storeToRefs 直改
    siteStore.setCalcError('')
    siteStore.setCalculating(true)
    try {
      const result = await apiRequest<AnalysisResult>('/site-analysis', {
        method: 'POST',
        body: JSON.stringify(params),
        signal,
        schema: siteAnalysisResponseSchema,
      })
      if (result.error) {
        siteStore.setCalcError(result.error)
        return {
          error: result.error,
          coverage: null,
          matchedXiaoqu: [],
          facilityPoi: {},
        }
      }
      // 8-1：无重叠区域是合法空结果（02 §4.1），透传 empty 标记，页面展示业务空态而非错误
      if (result.empty) {
        return {
          error: null,
          empty: true,
          emptyReason: result.emptyReason || '所选设施类型覆盖范围无重叠区域',
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
      // 分析接口免登录（2026-08-29），失败只写 calcError 不引导登录——提示统一由页面级
      // handleAnalysisError（经面板 emit('analysis-error')）触发，避免同一失败 toast 两次
      const msg = error instanceof Error ? error.message : '选址分析失败，请稍后重试'
      siteStore.setCalcError(msg)
      return { error: msg, coverage: null, matchedXiaoqu: [], facilityPoi: {} }
    } finally {
      if (isLatest(signal)) siteStore.setCalculating(false)
    }
  }

  // 取消在途请求并复位加载态（供调用方 onUnmounted 调用）
  function cancel(): void {
    cancelRequest()
    siteStore.setCalculating(false)
  }

  return { analyze, calculating, calcError, cancel }
}
