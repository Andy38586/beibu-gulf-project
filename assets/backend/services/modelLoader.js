/**
 * modelLoader — 读取吞吐量预测模型产物（cargo→throughput_model.json / container→container_model.json，
 * 由 tools/throughput_model.cjs 生成、`npm run forecast:model` 可复现，2026-08-29 起双指标）。
 * 数据源=官方真数据（2021-01~2026-06，yqb.gxzf.gov.cn）；
 * 训练期 2021-01~2024-12 / 验证期 2025-01~2026-06 / 滚动原点回测 origin 2024-01~2025-06。
 * 语义契约：固定基线（scenarioLevel 恒 1.0）；产物缺失返回 null，调用方降级 forecastEngine，
 * 模型不是服务可用性依赖；预测粒度 2026-07~12 逐月 + 2027~2035 每半年，重叠月丢弃、半年点月度线性插值；
 * 产物携带 rolling_mape_by_step 时 reliability/lower/upper 为实测口径，否则保持装饰值 1（向后兼容）
 */
import { logger } from '../utils/logger.js'
import { readStaticJson } from '../utils/readStaticJson.js'

// 指标 → 模型产物文件（container 2026-08-29 接入，与 cargo 同方法同口径）
const MODEL_FILES = {
  cargo: 'forecast/throughput_model.json',
  container: 'forecast/container_model.json',
}

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
export async function getModelForecast(portId, afterTime, indicator = 'cargo') {
  const modelFile = MODEL_FILES[indicator] || MODEL_FILES.cargo
  let model
  try {
    model = await readStaticJson(modelFile)
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

  // 真实误差透传：模型产物携带 rolling_mape_by_step（滚动回测分步长 MAPE）时，
  // reliability = 1 - 步长误差（装饰值 1 → 实测值）；lower/upper 为模型点自带区间（插值点线性内插）。
  // 旧产物/mock 无 rolling 字段时保持 reliability=1 旧行为（向后兼容）。
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

  return {
    forecast,
    metadata: {
      model: 'throughput_model',
      method: model.model_info?.method,
      trainingPeriod: model.model_info?.training_period,
      validationPeriod: model.model_info?.validation_period,
      forecastPeriod: model.model_info?.forecast_period,
      dataPeriod: model.model_info?.data_source,
      backtest: port.backtest,
      interpolated: true,
    },
  }
}
