import { Logger } from '@nestjs/common'

import type { DataFilesService } from '../../../infra/files/data-files.service'

// 吞吐量预测模型产物读取（逐行等价移植 backend/services/modelLoader.js）：
// cargo→throughput_model.json / container→container_model.json；语义契约：固定基线
//（scenarioLevel 恒 1.0）；产物缺失返回 null，调用方降级 forecastEngine，模型不是服务可用性依赖

interface ModelPoint {
  time: string
  value: number
  lower?: number
  upper?: number
}

interface ModelPort {
  predictions?: ModelPoint[]
  backtest?: Record<string, unknown> & { rolling_mape_by_step?: Record<string, number> }
}

function monthOffset(time: string): number {
  const [y, m] = time.split('-').map(Number)
  return y * 12 + (m - 1)
}

function timeFromOffset(off: number): string {
  const y = Math.floor(off / 12)
  const m = (off % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

// 模型点 → 月度序列：丢弃 ≤ afterTime 的重叠点，半年节点间线性插值（与 forecastEngine 输出同形）
export function interpolateMonthly(
  points: ModelPoint[],
  afterTime?: string
): Array<{
  time: string
  value: number
  type: string
  reliability: number
  lower?: number
  upper?: number
}> {
  const afterOff = afterTime ? monthOffset(afterTime) : -Infinity
  const kept = points
    .filter((p) => monthOffset(p.time) > afterOff)
    .sort((a, b) => a.time.localeCompare(b.time))

  const out: Array<{
    time: string
    value: number
    type: string
    reliability: number
    lower?: number
    upper?: number
  }> = []
  for (let i = 0; i < kept.length; i++) {
    const cur = kept[i]
    out.push({ time: cur.time, value: cur.value, type: 'forecast', reliability: 1 })
    const next = kept[i + 1]
    if (!next) continue
    const gap = monthOffset(next.time) - monthOffset(cur.time)
    for (let g = 1; g < gap; g++) {
      const t = g / gap
      out.push({
        time: timeFromOffset(monthOffset(cur.time) + g),
        value: Math.round(cur.value + (next.value - cur.value) * t),
        type: 'forecast',
        reliability: 1,
      })
    }
  }
  return out
}

const MODEL_FILES: Record<string, string> = {
  cargo: 'forecast/throughput_model.json',
  container: 'forecast/container_model.json',
}

const logger = new Logger('ModelLoader')

interface ModelFileShape {
  model_info?: Record<string, unknown>
  ports?: Record<string, ModelPort>
}

export interface ModelForecast {
  forecast: Array<{
    time: string
    value: number
    type: string
    reliability: number
    lower?: number
    upper?: number
  }>
  // scenarioLevel 不在此声明：产物为固定基线，由调用方（forecast.service）注入 1.0
  metadata: Record<string, unknown>
}

// 读取模型产物，返回指定港口的月度预测；产物不可用时返回 null（调用方降级）
export async function getModelForecast(
  dataFiles: DataFilesService,
  portId: string,
  afterTime?: string,
  indicator = 'cargo'
): Promise<ModelForecast | null> {
  const modelFile = MODEL_FILES[indicator] || MODEL_FILES.cargo
  let model: unknown
  try {
    model = await dataFiles.read(modelFile)
  } catch (err) {
    logger.warn(
      `模型产物读取失败（${(err as { code?: string; message?: string }).code || (err as Error).message}），调用方应降级 forecastEngine`
    )
    return null
  }
  const shaped = model as ModelFileShape | null
  const port = shaped && shaped.ports ? shaped.ports[portId] : undefined
  if (!port || !Array.isArray(port.predictions) || port.predictions.length === 0) {
    logger.warn(`模型产物缺少港口 ${portId} 的预测段，调用方应降级 forecastEngine`)
    return null
  }

  const forecast = interpolateMonthly(port.predictions, afterTime)
  if (forecast.length === 0) return null

  // 真实误差透传：产物携带 rolling_mape_by_step（滚动回测分步长 MAPE）时，
  // reliability = 1 - 步长误差；旧产物/mock 无 rolling 字段保持 reliability=1（向后兼容）
  const rolling = port.backtest?.rolling_mape_by_step
  if (rolling && typeof afterTime === 'string') {
    const afterOff = monthOffset(afterTime)
    const step12 = rolling[12] ?? null
    for (const p of forecast) {
      const relStep = monthOffset(p.time) - afterOff
      let stepMape = rolling[Math.min(relStep, 12)] ?? step12
      if (stepMape == null) continue // mock/旧产物无步长数据 → 保持 reliability=1
      if (relStep > 12) stepMape = stepMape * Math.sqrt(1 + Math.floor(relStep / 12))
      p.reliability = Math.max(0.25, Math.round((1 - stepMape / 100) * 100) / 100)
      if (typeof p.lower === 'number' && typeof p.upper === 'number') continue
      if (p.lower === undefined) p.lower = Math.round(p.value * (1 - stepMape / 100))
      if (p.upper === undefined) p.upper = Math.round(p.value * (1 + stepMape / 100))
    }
  }

  const info = shaped?.model_info ?? {}
  return {
    forecast,
    metadata: {
      model: 'throughput_model',
      method: info.method,
      trainingPeriod: info.training_period,
      validationPeriod: info.validation_period,
      forecastPeriod: info.forecast_period,
      dataPeriod: info.data_source,
      backtest: port.backtest,
      interpolated: true,
    },
  }
}
