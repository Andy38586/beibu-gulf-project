/**
 * modelLoader — 吞吐量预测模型产物读取（2026-08-09 接入正式服务链路）
 *
 * 读取 backend/data/forecast/throughput_model.json（生成产物，见 tools/throughput_model.cjs）。
 *
 * 数据链：
 * - 输入：backend/data/forecast/throughput.json（三港 2018-01~2025-12 吞吐量历史）
 * - 训练期 2018-2022 / 验证期 2023-2025（回测 MAPE 1.43%~2.3%）/ 预测期 2026-2035
 * - 产物可经 `npm run forecast:model` 完整复现（git 提交的产物与重跑结果逐字节一致）
 *
 * 语义契约：
 * - 模型为固定基线快照：scenarioLevel 恒 1.0（不支持情景参数，论文阶段再设计）
 * - 产物缺失/结构不符时返回 null，由调用方降级到 forecastEngine——
 *   模型不是服务可用性依赖，不因模型文件问题中断预测接口
 * - 预测粒度：2026 年逐月 + 2027~2035 每半年（6/12 月）节点；
 *   与历史重叠的月份（<= afterTime）丢弃；2027 起半年点做月度线性插值
 *   （纯可视化平滑，非模型新输出，插值点无 lower/upper）
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

/**
 * 模型点 → 月度预测序列：丢弃 <= afterTime 的重叠点，半年节点间线性插值。
 * 输出 [{ time, value, type: 'forecast', reliability }]（与 forecastEngine 输出同形）。
 * @param {Array<{time: string, value: number, lower?: number, upper?: number}>} points
 * @param {string|undefined} afterTime 历史末月（该月及之前的模型点丢弃）
 */
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

/**
 * 读取模型产物并返回指定港口的月度预测。
 * @param {string} portId 港口 id（qinzhou / beihai / fangchenggang）
 * @param {string|undefined} afterTime 历史末月，重叠的模型点被丢弃
 * @returns {Promise<{forecast: Array, metadata: object}|null>} 产物不可用时返回 null
 */
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
