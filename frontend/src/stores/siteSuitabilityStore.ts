import { defineStore } from 'pinia'
import type { Ref } from 'vue'
import { ref } from 'vue'

import type { SiteSuitabilityResponseParsed } from '@/types/schemas'

// 新选址适宜性 store（单元五）：五准则权重 + 过滤阈值 + 请求事务态。
// 复刻 forecastStore 的事务模式（bumpTransactionId/isRequesting 由请求 composable 消费）；
// 无跨页面快照需求（v1 不持久化——权重是实验性交互态，登录返回重置为缺省可接受）。

export interface SuitabilityWeightsState {
  inundation: number
  terrain: number
  land: number
  access: number
  demand: number
}

export const useSiteSuitabilityStore = defineStore('siteSuitability', () => {
  /** 五准则权重（0..1；端点校验和=1——滑块调整后由 store 归一化） */
  const weights: Ref<SuitabilityWeightsState> = ref({
    inundation: 0.4,
    terrain: 0.1,
    land: 0.2,
    access: 0.2,
    demand: 0.1,
  })
  /** 最小陆像元占比过滤（0..1） */
  const minLandFrac: Ref<number> = ref(0.5)

  const activeTransactionId: Ref<number> = ref(0)
  const isRequesting: Ref<boolean> = ref(false)
  /** /site-suitability/map 解析响应：左上分布 + 左下 Top-N 面板的唯一数据源 */
  const data: Ref<SiteSuitabilityResponseParsed | null> = ref(null)

  function bumpTransactionId(): number {
    activeTransactionId.value += 1
    return activeTransactionId.value
  }

  function setIsRequesting(v: boolean): void {
    isRequesting.value = v
  }

  /** 写入最近一次成功响应；失败/取消不覆盖旧数据（页面卸载由 reset 清空） */
  function setData(v: SiteSuitabilityResponseParsed | null): void {
    data.value = v
  }

  /** 单准则权重写入并整体归一化（和=1；滑块语义：拉高一个，其余等比压缩） */
  function setWeight(key: keyof SuitabilityWeightsState, value: number): void {
    const v = Math.min(1, Math.max(0, value))
    const restKeys = (Object.keys(weights.value) as Array<keyof SuitabilityWeightsState>).filter(
      (k) => k !== key
    )
    const restSum = restKeys.reduce((acc, k) => acc + weights.value[k], 0)
    weights.value[key] = v
    const remain = 1 - v
    if (restSum <= 0) {
      // 其余全为 0 时把 remain 平均分给第一个其余键（保持和=1）
      restKeys.forEach((k, i) => (weights.value[k] = i === 0 ? remain : 0))
      return
    }
    for (const k of restKeys) {
      weights.value[k] = (weights.value[k] / restSum) * remain
    }
  }

  function setMinLandFrac(v: number): void {
    minLandFrac.value = Math.min(1, Math.max(0, v))
  }

  /** 权重四舍五入到 4 位（消除浮点残差，保证和恰好可过端点校验） */
  function normalizedWeights(): Record<string, number> {
    const out: Record<string, number> = {}
    let sum = 0
    const keys = Object.keys(weights.value) as Array<keyof SuitabilityWeightsState>
    keys.forEach((k, i) => {
      const v = i === keys.length - 1 ? 1 - sum : Math.round(weights.value[k] * 10000) / 10000
      out[k] = v
      sum += v
    })
    return out
  }

  function reset(): void {
    weights.value = { inundation: 0.4, terrain: 0.1, land: 0.2, access: 0.2, demand: 0.1 }
    minLandFrac.value = 0.5
    activeTransactionId.value = 0
    isRequesting.value = false
    data.value = null
  }

  return {
    weights,
    minLandFrac,
    activeTransactionId,
    isRequesting,
    data,
    bumpTransactionId,
    setIsRequesting,
    setData,
    setWeight,
    setMinLandFrac,
    normalizedWeights,
    reset,
  }
})
