/**
 * useForecastOrchestrator — 预测三路请求的编排器（v4-S3 请求归属上移的落点）。
 *
 * ## 职责（总纲 §3.1 口径：面板管"要什么"，store 管"跑到哪"，页面管"画出来"）
 *
 * 把原 ForecastPage 内联的 `doForecastUpdate`（startTransaction + 三路并行）收拢为
 * 一个可被页面与面板**共享的单一实例**：页面在渲染器就绪时调用（渲染侧初始化），
 * 面板在用户改参数时调用（请求由面板发起）。
 *
 * ## 🔴 为什么必须 provide/inject 而不能各实例一份
 *
 * `useForecastRequest` 的 AbortController 是**实例级**持有（事务取消语义依赖"同一实例
 * 取消自己的请求"）——页面与面板各建一份就会产生两条互不知晓的事务链，竞态守卫失效。
 * 因此实例只建一份（页面 setup），经 `FORECAST_ORCHESTRATOR_KEY` 注入给面板。
 *
 * ## 图层更新为何留在编排内
 *
 * `updateForecastLayer` 是三路事务的第三路（forecast/map 取数同事务），不是纯渲染；
 * 真正的"画"（图表绑定 store.chart、图层写入 renderer）在页面与渲染器侧完成。
 */
import { inject, provide } from 'vue'

import { useMapStore } from '@/stores'

import { useForecastComparison } from './useForecastComparison'
import { useForecastRequest } from './useForecastRequest'
import { useForecastTimeseries } from './useForecastTimeseries'

/** 注入 key（页面 provide、面板 inject；business 内部契约，不上提 core/shared） */
export const FORECAST_ORCHESTRATOR_KEY = 'forecast-orchestrator'

interface ForecastOrchestrator {
  /** 三路事务：预测趋势 + 港口对比 + 图层数据（共享同一事务 ID，旧事务自动取消） */
  doForecastUpdate: () => Promise<void>
  /** 取消全部在飞请求（页面卸载链用） */
  cancelAll: () => void
}

export function provideForecastOrchestrator(deps: {
  updateForecastLayer: (transactionId: number, signal: AbortSignal) => Promise<void>
}): ForecastOrchestrator {
  const mapStore = useMapStore()
  const { startTransaction, cancelAll } = useForecastRequest()
  const ts = useForecastTimeseries()
  const cmp = useForecastComparison()

  async function doForecastUpdate(): Promise<void> {
    if (!mapStore.currentRenderer) return

    // 启动新事务，取消旧请求（三路共享同一事务，保证数据一致性）
    const { transactionId, signal } = startTransaction()
    await Promise.all([
      ts.load(transactionId, signal),
      cmp.load(transactionId, signal),
      deps.updateForecastLayer(transactionId, signal),
    ])
  }

  const orchestrator: ForecastOrchestrator = { doForecastUpdate, cancelAll }
  provide(FORECAST_ORCHESTRATOR_KEY, orchestrator)
  return orchestrator
}

/** 面板侧注入（页面必提供；缺提供 = 接线断裂，抛错而非静默吞） */
export function useForecastOrchestrator(): ForecastOrchestrator {
  const orchestrator = inject<ForecastOrchestrator | null>(FORECAST_ORCHESTRATOR_KEY, null)
  if (!orchestrator) {
    throw new Error('[ForecastControlPanel] 未注入 forecast 编排器——面板只能在 ForecastPage 内使用')
  }
  return orchestrator
}
