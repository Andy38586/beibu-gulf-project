/**
 * 滚动原点回测 harness——与 throughput_model.cjs 线性回测同协议同判据，供候选模型公平竞选。
 *
 * 协议（04-B10 可复算，与线性版逐字一致）：
 *   - origin 从 originStart 到 originEnd 逐月推进；每个 origin 用 time < origin 的数据训练
 *   - 每个 origin 预测未来 horizon 个月，与真数据重叠段计误差（超出真数据范围的步长跳过）
 *   - 回测内模型只准用训练段信息（含春节修正的 h̄ 基准——由 fitFn 内部按训练段重建）
 *
 * 指标：
 *   - mapeByStep：与线性版同口径（分步长平均绝对百分比误差，%）
 *   - maseByStep：分步长 MASE（Hyndman & Koehler 2006），尺度 Q = 训练段季节朴素法的
 *     平均绝对一阶季节差 mean|y_t − y_{t−12}|；MASE_s = (Σ|e_s|/N_s) / (ΣQ/origin 数)。
 *     MASE < 1 = 优于一步朴素法，跨序列可比，补 MAPE 对近零值不稳的缺陷
 */
'use strict'

function monthIndex(timeStr) {
  const [y, m] = timeStr.split('-').map(Number)
  return y * 12 + m
}

function indexToTime(idx) {
  const y = Math.floor((idx - 1) / 12)
  const m = ((idx - 1) % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

function addMonths(timeStr, n) {
  return indexToTime(monthIndex(timeStr) + n)
}

/** 训练段季节朴素尺度 Q：mean|y_t − y_{t−m}|（样本不足时返回 null） */
function seasonalNaiveScale(sortedValues, m) {
  if (sortedValues.length <= m) return null
  let sum = 0
  let cnt = 0
  for (let i = m; i < sortedValues.length; i++) {
    sum += Math.abs(sortedValues[i] - sortedValues[i - m])
    cnt++
  }
  return cnt > 0 ? sum / cnt : null
}

/**
 * @param {Object} p
 * @param {Array<{time,value}>} p.historical 全量真数据
 * @param {Function} p.fitFn (train: [{time,value}]) => model | null（数据不足返回 null 则跳过该 origin）
 * @param {Function} p.forecastFn (model, timeStr) => number | null
 * @param {string} [p.originStart] 默认与线性版一致（'2024-01'）
 * @param {string} [p.originEnd]   默认与线性版一致（'2026-06'）
 * @param {number} [p.horizon]     默认 12
 * @param {number} [p.m]           季节周期，默认 12
 */
function runRollingBacktest({
  historical,
  fitFn,
  forecastFn,
  originStart = '2024-01',
  originEnd = '2026-06',
  horizon = 12,
  m = 12,
}) {
  const sorted = [...historical].sort((a, b) => a.time.localeCompare(b.time))
  const byTime = new Map(sorted.map((d) => [d.time, d.value]))

  const errByStep = {}
  const absErrByStep = {}
  const cntByStep = {}
  const qSumByStep = {}
  const qCntByStep = {}
  for (let s = 1; s <= horizon; s++) {
    errByStep[s] = 0
    absErrByStep[s] = 0
    cntByStep[s] = 0
    qSumByStep[s] = 0
    qCntByStep[s] = 0
  }

  let origin = originStart
  let originCount = 0
  while (origin <= originEnd) {
    const train = sorted.filter((d) => d.time < origin)
    const model = fitFn(train)
    if (model) {
      originCount++
      const q = seasonalNaiveScale(
        train.map((d) => d.value),
        m
      )
      for (let step = 1; step <= horizon; step++) {
        const t = addMonths(origin, step - 1)
        const actual = byTime.get(t)
        if (actual === undefined) continue
        const predicted = forecastFn(model, t)
        if (predicted === null || !Number.isFinite(predicted)) continue
        const absErr = Math.abs(actual - predicted)
        errByStep[step] += absErr / actual // 相对误差 → MAPE
        absErrByStep[step] += absErr // 原单位绝对误差 → MASE（与 Q 同量纲，04-B4）
        cntByStep[step]++
        if (q !== null) {
          qSumByStep[step] += q
          qCntByStep[step]++
        }
      }
    }
    origin = addMonths(origin, 1)
  }

  const mapeByStep = {}
  const maseByStep = {}
  let mapeSum = 0
  let mapeCnt = 0
  let maseSum = 0
  let maseCnt = 0
  for (let s = 1; s <= horizon; s++) {
    mapeByStep[s] =
      cntByStep[s] > 0 ? Math.round((errByStep[s] / cntByStep[s]) * 10000) / 100 : null
    if (mapeByStep[s] !== null) {
      mapeSum += mapeByStep[s]
      mapeCnt++
    }
    const meanAbsErr = cntByStep[s] > 0 ? absErrByStep[s] / cntByStep[s] : null
    const meanQ = qCntByStep[s] > 0 ? qSumByStep[s] / qCntByStep[s] : 0
    maseByStep[s] =
      meanAbsErr !== null && meanQ > 0 ? Math.round((meanAbsErr / meanQ) * 100) / 100 : null
    if (maseByStep[s] !== null) {
      maseSum += maseByStep[s]
      maseCnt++
    }
  }

  return {
    mapeByStep,
    maseByStep,
    samplesByStep: cntByStep,
    origins: originCount,
    overallMape: mapeCnt > 0 ? Math.round((mapeSum / mapeCnt) * 100) / 100 : null,
    overallMase: maseCnt > 0 ? Math.round((maseSum / maseCnt) * 100) / 100 : null,
  }
}

/**
 * seasonal-naive 基准：预测值 = 训练段内同月最近一年的观测。
 * 价值：它是任何季节模型必须打赢的下限——打不赢说明模型连"复读去年"都不如（闸门判据之一）。
 */
function seasonalNaiveModel(train) {
  if (train.length < 13) return null
  const byMonth = new Map()
  for (const d of train) {
    const month = parseInt(d.time.split('-')[1], 10)
    byMonth.set(month, d.value) // train 已按时间升序，后者覆盖前者 = 最近一年
  }
  return { byMonth }
}

function seasonalNaiveForecast(model, timeStr) {
  const month = parseInt(timeStr.split('-')[1], 10)
  const v = model.byMonth.get(month)
  return v === undefined ? null : v
}

/**
 * 闸门选优（导出供单测）：ETS 必须在全步长平均 MAPE 上**同时严格优于**
 * 线性基线与季节朴素基准才可替换，否则保留线性（诚实降级——判据写死在实现里）。
 * 任何分数非有限（回测无样本）时一律保留线性。
 */
function selectModel(scores) {
  const ok = (x) => x !== null && Number.isFinite(x)
  const { linear, ets, seasonal_naive: sn } = scores
  if (!ok(linear) || !ok(ets) || !ok(sn)) return 'linear'
  if (ets < linear && ets < sn) return 'ets'
  return 'linear'
}

module.exports = {
  runRollingBacktest,
  seasonalNaiveModel,
  seasonalNaiveForecast,
  seasonalNaiveScale,
  selectModel,
  addMonths,
  monthIndex,
  indexToTime,
}
