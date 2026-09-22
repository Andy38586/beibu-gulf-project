/**
 * useFloodRequest — 浸没分析的请求能力（v4-S3）。
 *
 * ── 为什么需要单独一个 composable ────────────────────────────────────────────
 * v4-S3 要把「请求发起权」从页面搬进 `WaterLevelProfilePanel`。但 flood 的请求
 * 不只是「调接口」：它有多种触发来源（滑块防抖 / 刻度点击 / dock 后台任务），
 * 共用同一套「取数 → 竞态校验 → 写 store」逻辑。把这套逻辑放面板里，
 * 页面就没法在「面板被拖走后」继续驱动——而拖走后任务恰恰要继续跑。
 *
 * 所以拆两层：
 *   · 本 composable = **纯能力**（取数 + 竞态守卫），不假设谁在调用
 *   · `WaterLevelProfilePanel` = **发起者**（决定何时调、以何种方式调）
 *
 * ── 两条执行路径 ───────────────────────────────────────────────────────────
 * ① **直连**（默认；滑块拖动走这条）：`flood-areas + statistics` 并行 + `disaster`，
 *    即 v3 的既有路径，**体验零变化**。
 * ② **任务**（仅「拖入 dock」走这条）：淹没范围走 `taskStore`
 *    （domain `flood-areas`），**statistics 与 disaster 仍走直连**。
 *
 * 🔴 为什么滑块不走任务队列：flood 是**连续手势**（拖一次 0→10m 可能触发 5~10 轮），
 *    而后端队列并发上限 1、容量 8 ⇒ 一次拖动就打满队列、后续被 503 拒绝，
 *    滑块会卡顿甚至失去响应。这与「布局与体验保持一致」的要求直接冲突。
 *    离散操作（切指标、点查询）没有这个问题，所以 forecast/route 走队列。
 *
 * 🔴 任务路径的**覆盖边界**（不掩盖、不伪造）：
 *    后端 `flood-areas` 域只封装了 `GET /flood/flood-areas`，返回淹没范围 + riskLevel，
 *    不含 statistics（面积/水深/设施数）与 disaster（设施明细/损失）。
 *    因此本 composable 在任务路径下**仍直连补齐这两项**——而不是把缺的字段填 0
 *    （填 0 会把「没拿到」显示成「真的没有」，是最坏的一种错）。
 *    若要任务一次拿全三端点，需在后端补一个覆盖三者的域，属后续迭代。
 */
import { floodAdapter } from '@/services'
import { logger, showError, useLatestRequest } from '@/shared'
import { useTaskStore } from '@/stores'
import type { AffectedFacility, FloodFeature, FloodStatistics } from '@/types/business/base'

/** 本页路由标识（taskStore 按 route 分槽的 key） */
export const FLOOD_ROUTE_PATH = '/flood-analysis'

/** 防抖 100ms：500ms 时滑块感知延迟约 70% 来自防抖等待（沿用 v3 口径） */
export const FLOOD_ANALYSIS_DELAY = 100

export interface FloodAnalysisPayload {
  features: FloodFeature[]
  statistics: FloodStatistics
  riskLevel: string
  /** 实际命中档位（后端向上取档时 ≠ 请求水位；面板可据此回显） */
  actualWaterLevel?: number
}

export interface FloodImpactPayload {
  affectedFacilities: AffectedFacility[]
  totalLoss: number
}

export interface UseFloodRequestReturn {
  /**
   * 取淹没分析（范围 + 统计 + 风险等级）。
   *
   * @param waterLevel 水位
   * @param viaTask true = 淹没范围走后端异步任务域（仅 dock 场景）；
   *                false = 三端点全直连（滑块场景，默认）
   * @returns 失败/被抢占返回 null（调用方据此跳过渲染，不弹错——错误已在内部 toast）
   */
  fetchAnalysis: (waterLevel: number, viaTask?: boolean) => Promise<FloodAnalysisPayload | null>
  /** 取影响评估（受影响设施 + 损失） */
  fetchImpact: (waterLevel: number) => Promise<FloodImpactPayload | null>
  /**
   * 作废在途的**直连**请求。
   *
   * 🔴 只 abort HTTP，**绝不**取消后端任务：任务状态属 taskStore，
   *    页面卸载/新请求抢占都不构成取消理由（保活语义）。
   */
  abortInflight: () => void
}

export function useFloodRequest(): UseFloodRequestReturn {
  const taskStore = useTaskStore()

  // flood/impact 两路竞态守卫各持独立实例（淹没分析与影响评估互不干扰）
  const { createSignal: createFloodSignal } = useLatestRequest()
  const { createSignal: createImpactSignal } = useLatestRequest()

  function abortInflight(): void {
    // 同一实例再建一次 signal ⇒ 上一路的 signal 被 abort，其迟到响应自行作废
    createFloodSignal()
    createImpactSignal()
  }

  async function fetchAnalysis(
    waterLevel: number,
    viaTask = false
  ): Promise<FloodAnalysisPayload | null> {
    if (viaTask) {
      // ── 任务路径：淹没范围交给后端异步任务域 ─────────────────────────────
      const { slot } = await taskStore.submitAndWait({
        route: FLOOD_ROUTE_PATH,
        domain: 'flood-areas',
        params: { waterLevel },
      })
      if (!slot) {
        logger.debug('[Flood] 任务槽位已移除，跳过渲染（水位', waterLevel, '）')
        return null
      }
      if (slot.status === 'cancelled') {
        logger.debug('[Flood] 任务已取消，跳过渲染（水位', waterLevel, '）')
        return null
      }
      if (slot.status !== 'done') {
        // failed 的 toast 已由 taskStore.settle 统一弹出，这里不重复提示
        logger.warn('[Flood] 淹没范围任务未成功', slot.status, slot.error)
        return null
      }

      const result = slot.result as
        | {
            features?: FloodFeature[]
            riskLevel?: string
            actualWaterLevel?: number
            waterLevel?: number
          }
        | undefined
      if (!result) return null

      const features = (result.features ?? []) as FloodFeature[]
      const actualWaterLevel = result.actualWaterLevel ?? result.waterLevel

      // 🔴 任务域不提供 statistics（面积/水深/设施数）⇒ 直连补齐。
      //    不伪造零值：零值会把「没拿到」显示成「真的没有」。
      const statistics = await fetchStatistics(waterLevel)
      if (!statistics) return null

      return {
        features,
        statistics,
        riskLevel: result.riskLevel ?? statistics.riskLevel,
        actualWaterLevel,
      }
    }

    // ── 直连路径（滑块拖动走这条，与 v3 完全一致）────────────────────────
    const signal = createFloodSignal()
    try {
      const { features, statistics, riskLevel, actualWaterLevel } =
        await floodAdapter.getFloodAnalysis(waterLevel, { signal })
      if (signal.aborted) return null
      return {
        features: features as FloodFeature[],
        statistics: statistics as FloodStatistics,
        riskLevel,
        actualWaterLevel,
      }
    } catch (error) {
      // 主动取消（新请求抢占/卸载）静默——showError 只兜真实错误
      if (signal.aborted) return null
      // 失败用 toast：滑块拖动即自动重试，"重试"按钮是伪需求
      showError(error, { fallback: '淹没分析失败，请检查网络连接' })
      logger.error('[Flood] 淹没分析失败:', error)
      return null
    }
  }

  /** 单取统计数据（任务路径的补齐步骤；直连路径由 adapter 内部并行取） */
  async function fetchStatistics(waterLevel: number): Promise<FloodStatistics | null> {
    const signal = createFloodSignal()
    try {
      const stats = await floodAdapter.getFloodStatistics(waterLevel, { signal })
      if (signal.aborted) return null
      return stats as FloodStatistics
    } catch (error) {
      if (signal.aborted) return null
      showError(error, { fallback: '淹没统计加载失败，请检查网络连接' })
      logger.error('[Flood] 统计加载失败:', error)
      return null
    }
  }

  async function fetchImpact(waterLevel: number): Promise<FloodImpactPayload | null> {
    const signal = createImpactSignal()
    try {
      const { affectedFacilities, totalLoss } = await floodAdapter.getImpactAssessment(waterLevel, {
        signal,
      })
      if (signal.aborted) return null
      return {
        affectedFacilities: affectedFacilities as AffectedFacility[],
        totalLoss,
      }
    } catch (error) {
      if (signal.aborted) return null
      showError(error, { fallback: '影响评估失败，请检查网络连接' })
      logger.error('[Flood] 影响评估失败:', error)
      return null
    }
  }

  return { fetchAnalysis, fetchImpact, abortInflight }
}
