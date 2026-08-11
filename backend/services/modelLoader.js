/**
 * modelLoader — 读取吞吐量预测模型产物（throughput_model.json，由 tools/throughput_model.cjs 生成、
 * `npm run forecast:model` 可复现）。训练期 2018-2022 / 验证期 2023-2025（回测 MAPE 1.43%~2.3%）/
 * 预测期 2026-2035。
 * 语义契约：固定基线（scenarioLevel 恒 1.0）；产物缺失返回 null，调用方降级 forecastEngine，
 * 模型不是服务可用性依赖；预测粒度 2026 逐月 + 2027~2035 每半年，重叠月丢弃、半年点月度线性插值
 */
import { logger } from '../utils/logger.js'
import { readStaticJson } from '../utils/readStaticJson.js'

const MODEL_FILE = 'forecast/throughput_model.json'

function monthOffset(time) {
  const [y, m] = time.split('-').map(Number)
  return y * 12 + (m - 1)
}

function timeFromOffset(off) {
  const y = Math.floor(off / 12)
  const m = (off % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

/** 模型点 → 月度序列：丢弃 ≤ afterTime 的重叠点，半年节点间线性插值（与 forecastEngine 输出同形） */
export function interpolateMonthly(points, afterTime) {
  const afterOff = afterTime ? monthOffset(afterTime) : -Infinity
  const kept = points
    .filter((p) => monthOffset(p.time) > afterOff)
    .sort((a, b) => a.time.localeCompare(b.time))

  const out = []
  for (let i = 0; i < kept.length; i++) {
    const cur = kept[i]
    out.push({
      time: cur.time,
      value: cur.value,
      type: 'forecast',
      reliability: 1,
    })
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

/** 读取模型产物，返回指定港口的月度预测；产物不可用时返回 null（调用方降级） */
export async function getModelForecast(portId, afterTime) {
  let model
  try {
    model = await readStaticJson(MODEL_FILE)
  } catch (err) {
    logger.warn(
      `[modelLoader] 模型产物读取失败（${err.code || err.message}），调用方应降级 forecastEngine`
    )
    return null
  }
  const port = model && model.ports ? model.ports[portId] : undefined
  if (!port || !Array.isArray(port.predictions) || port.predictions.length === 0) {
    logger.warn(`[modelLoader] 模型产物缺少港口 ${portId} 的预测段，调用方应降级 forecastEngine`)
    return null
  }

  const forecast = interpolateMonthly(port.predictions, afterTime)
  if (forecast.length === 0) return null

  return {
    forecast,
    metadata: {
      model: 'throughput_model',
      method: model.model_info?.method,
      trainingPeriod: model.model_info?.training_period,
      validationPeriod: model.model_info?.validation_period,
      forecastPeriod: model.model_info?.forecast_period,
      backtest: port.backtest,
      interpolated: true,
    },
  }
}
