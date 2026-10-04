import { defineStore } from 'pinia'
import type { Ref } from 'vue'
import { ref } from 'vue'

import { ENDPOINTS, logger, useApiRequest } from '@/shared'
import type { SiteSuitabilityDefaultsParsed, SiteSuitabilityResponseParsed } from '@/types/schemas'
import { siteSuitabilityDefaultsSchema } from '@/types/schemas'

import {
  SNAPSHOT_MIN_LAND_FRAC,
  SNAPSHOT_PROVENANCE,
  SNAPSHOT_WEIGHTS,
} from './siteSuitabilityDefaults.snapshot'
import { createTransactionId } from './factories/createTransactionId'
import type { SuitabilityWeightsState } from './siteSuitabilityDefaults.snapshot'
export type { SuitabilityWeightsState }

// 新选址分析 store（单元五）：五准则权重 + 过滤阈值 + 请求事务态。
// 复刻 forecastStore 的事务模式（bumpTransactionId/isRequesting 由请求 composable 消费）；
// 无跨页面快照需求（v1 不持久化——权重是实验性交互态，登录返回重置为缺省可接受）。
//
// 权重权威源 = 后端 GET /site-suitability/defaults（用户 2026-10-04 裁决以后端为准）。
// 初值/reset 读同值快照（siteSuitabilityDefaults.snapshot.ts，后端定稿的发布副本）；
// 页面首刷前调 loadDefaults() 拉一次：成功用后端值覆盖（info 留痕），失败保留快照
// （warn 留痕带快照身份）。成功/兜底在日志可区分，UI 无区别。

export const useSiteSuitabilityStore = defineStore('siteSuitability', () => {
  const { apiRequest } = useApiRequest()
  /** 五准则权重（0..1；端点校验和=1——滑块调整后由 store 归一化） */
  const weights: Ref<SuitabilityWeightsState> = ref({ ...SNAPSHOT_WEIGHTS })
  /** 最小陆像元占比过滤（0..1） */
  const minLandFrac: Ref<number> = ref(SNAPSHOT_MIN_LAND_FRAC)

  const { activeTransactionId, bumpTransactionId } = createTransactionId()
  const isRequesting: Ref<boolean> = ref(false)
  /** /site-suitability/map 解析响应：左上分布 + 左下 Top-N 面板的唯一数据源 */
  const data: Ref<SiteSuitabilityResponseParsed | null> = ref(null)
  /**
   * defaults 来源（仅日志/测试可辨，UI 不消费）：pending = 未拉过，
   * remote = 后端直连成功，snapshot = 拉取失败快照兜底。
   */
  const defaultsSource: Ref<'pending' | 'remote' | 'snapshot'> = ref('pending')
  /** once 守卫：权重 watch 回写会重入 doUpdate，同页多次调用只发一次请求 */
  let defaultsPromise: Promise<void> | null = null

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

  /** 后端 defaults 全量应用（逐键赋值：schema 的 Record 形不直接等同州形状） */
  function applyDefaults(d: SiteSuitabilityDefaultsParsed): void {
    weights.value = {
      inundation: d.weights.inundation,
      terrain: d.weights.terrain,
      land: d.weights.land,
      access: d.weights.access,
      demand: d.weights.demand,
    }
    minLandFrac.value = d.minLandFrac
  }

  /**
   * 默认值单源拉取（幂等）：成功覆盖为后端值并 info 留痕；失败保留快照初值
   * 并 warn 留痕（带快照身份 + 错误摘要）。生产控制台"无 warn = 直连成功、
   * 有 warn = 快照兜底"。后端未就绪的单测/离线页走兜底分支是预期行为。
   */
  function loadDefaults(): Promise<void> {
    if (defaultsPromise) return defaultsPromise
    defaultsPromise = (async (): Promise<void> => {
      try {
        const d = await apiRequest<SiteSuitabilityDefaultsParsed>(
          ENDPOINTS.siteSuitability.defaults,
          { method: 'GET', schema: siteSuitabilityDefaultsSchema }
        )
        applyDefaults(d)
        defaultsSource.value = 'remote'
        logger.info('[site-suitability] defaults 后端直连成功', d.source)
      } catch (e) {
        defaultsSource.value = 'snapshot'
        logger.warn('[site-suitability] defaults 拉取失败，快照兜底', {
          snapshot: { ...SNAPSHOT_PROVENANCE },
          error: e instanceof Error ? e.message : String(e),
        })
      }
    })()
    return defaultsPromise
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
    weights.value = { ...SNAPSHOT_WEIGHTS }
    minLandFrac.value = SNAPSHOT_MIN_LAND_FRAC
    activeTransactionId.value = 0
    isRequesting.value = false
    data.value = null
    defaultsSource.value = 'pending'
    defaultsPromise = null
  }

  return {
    weights,
    minLandFrac,
    activeTransactionId,
    isRequesting,
    data,
    defaultsSource,
    bumpTransactionId,
    setIsRequesting,
    setData,
    setWeight,
    setMinLandFrac,
    applyDefaults,
    loadDefaults,
    normalizedWeights,
    reset,
  }
})
