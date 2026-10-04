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
 *   - smapeByStep：分步长 sMAPE（Hyndman & Koehler 2006）= mean(2|e|/(|y|+|ŷ|))×100，
 *     补 MAPE 对低基数/单侧偏离的系统性偏倚（L5）；|y|+|ŷ|=0 的点不计
 *   - maseByStep：分步长 MASE（Hyndman & Koehler 2006），尺度 Q = 训练段季节朴素法的
 *     平均绝对一阶季节差 mean|y_t − y_{t−12}|；MASE_s = (Σ|e_s|/N_s) / (ΣQ/origin 数)。
 *     MASE < 1 = 优于一步朴素法，跨序列可比，补 MAPE 对近零值不稳的缺陷
 *   - picpByStep：预测区间覆盖率（L5）——仅当传入 intervalFn(model, time) => {lo,hi}|null
 *     时累计；区间缺失(null/非有限)的点不计入分母。PICP ≈ 名义置信水平为合格
 *   - series：逐点 {time, step, actual, predicted}（供 DM 检验对齐损失差，lib/evaluate.cjs）
 */
'use strict'

const { combinePredictions, combinationWeights } = require('./combination.cjs')

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
 * @param {Array<{key,fitFn,forecastFn}>} [p.members] 组合模式：非空时忽略 fitFn/forecastFn，
 *   每个 origin 各成员分别拟合，按 weightTracker 当前权重（未喂过/快照空 → 等权）组合；
 *   成员误差按"目标时点 ≤ 当前 origin"过滤后逐 origin 喂给 tracker——这些时点的真值在
 *   下一 origin 的训练段内，属严格因果（防未来泄漏）。
 * @param {Object} [p.weightTracker] createWeightTracker() 实例；仅组合模式使用
 * @param {Function} [p.intervalFn] (model, timeStr) => {lo,hi} | null（PICP 用；缺省不计区间覆盖率）
 * @param {string} [p.originStart] 默认与线性版一致（'2024-01'）
 * @param {string} [p.originEnd]   默认与线性版一致（'2026-06'）
 * @param {number} [p.horizon]     默认 12
 * @param {number} [p.m]           季节周期，默认 12
 */
function runRollingBacktest({
  historical,
  fitFn,
  forecastFn,
  members = null,
  weightTracker = null,
  intervalFn = null,
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
  const smapeSumByStep = {}
  const smapeCntByStep = {}
  const picpHitByStep = {}
  const picpCntByStep = {}
  const series = []
  for (let s = 1; s <= horizon; s++) {
    errByStep[s] = 0
    absErrByStep[s] = 0
    cntByStep[s] = 0
    qSumByStep[s] = 0
    qCntByStep[s] = 0
    smapeSumByStep[s] = 0
    smapeCntByStep[s] = 0
    picpHitByStep[s] = 0
    picpCntByStep[s] = 0
  }

  let origin = originStart
  let originCount = 0
  const memberErrors = [] // {time, key, pct}：各成员在每个时点的已实现相对误差（组合模式）
  while (origin <= originEnd) {
    const train = sorted.filter((d) => d.time < origin)
    const fitted = members
      ? members.map((m) => ({ ...m, model: m.fitFn(train) })).filter((m) => m.model)
      : null
    const model = members ? (fitted.length > 0 ? { members: fitted } : null) : fitFn(train)
    if (model) {
      originCount++
      const q = seasonalNaiveScale(
        train.map((d) => d.value),
        m
      )
      let weights = null
      if (members) {
        const trackerWeights = weightTracker ? weightTracker.weights() : null
        // 未喂过或快照为空（首 origin 前无已实现误差）→ 等权起步（组合设计契约）
        weights =
          trackerWeights && Object.keys(trackerWeights).length > 0
            ? trackerWeights
            : Object.fromEntries(fitted.map((mm) => [mm.key, 1 / fitted.length]))
      }
      for (let step = 1; step <= horizon; step++) {
        const t = addMonths(origin, step - 1)
        const actual = byTime.get(t)
        if (actual === undefined) continue
        if (members) {
          for (const mm of fitted) {
            const mv = mm.forecastFn(mm.model, t)
            if (Number.isFinite(mv) && actual !== 0) {
              memberErrors.push({
                time: t,
                key: mm.key,
                pct: Math.abs(actual - mv) / Math.abs(actual),
              })
            }
          }
        }
        const predicted = members
          ? combinePredictions(
              fitted.map((mm) => ({ key: mm.key, value: mm.forecastFn(mm.model, t) })),
              weights
            )
          : forecastFn(model, t)
        if (predicted === null || !Number.isFinite(predicted)) continue
        const absErr = Math.abs(actual - predicted)
        errByStep[step] += absErr / actual // 相对误差 → MAPE
        absErrByStep[step] += absErr // 原单位绝对误差 → MASE（与 Q 同量纲，04-B4）
        cntByStep[step]++
        const denom = Math.abs(actual) + Math.abs(predicted)
        if (denom > 0) {
          smapeSumByStep[step] += (2 * absErr) / denom // → sMAPE（H&K 2006）
          smapeCntByStep[step]++
        }
        series.push({ time: t, step, actual, predicted })
        if (intervalFn) {
          const itv = intervalFn(model, t)
          if (itv && Number.isFinite(itv.lo) && Number.isFinite(itv.hi)) {
            picpCntByStep[step]++
            if (actual >= itv.lo && actual <= itv.hi) picpHitByStep[step]++
          }
        }
        if (q !== null) {
          qSumByStep[step] += q
          qCntByStep[step]++
        }
      }
      if (members && weightTracker) {
        const scores = {}
        for (const mm of members) {
          // 严格因果：目标时点 ≤ 当前 origin 的误差，其真值在下一 origin 的训练段内；
          // 目标时点 ≥ origin+1 的误差一律排除（防未来泄漏）
          const errs = memberErrors.filter((e) => e.key === mm.key && e.time <= origin)
          if (errs.length > 0) {
            scores[mm.key] = (errs.reduce((a, e) => a + e.pct, 0) / errs.length) * 100
          }
        }
        weightTracker.update(scores)
      }
    }
    origin = addMonths(origin, 1)
  }
  const memberScores = members
    ? Object.fromEntries(
        members.map((mm) => {
          const errs = memberErrors.filter((e) => e.key === mm.key)
          return [
            mm.key,
            errs.length > 0
              ? Math.round((errs.reduce((a, e) => a + e.pct, 0) / errs.length) * 10000) / 100
              : null,
          ]
        })
      )
    : null
  const finalWeights =
    members && memberScores
      ? combinationWeights(
          Object.fromEntries(Object.entries(memberScores).filter(([, v]) => v !== null))
        )
      : null

  const mapeByStep = {}
  const smapeByStep = {}
  const picpByStep = {}
  const maseByStep = {}
  let mapeSum = 0
  let mapeCnt = 0
  let smapeSum = 0
  let smapeCnt = 0
  let picpHitTotal = 0
  let picpCntTotal = 0
  let maseSum = 0
  let maseCnt = 0
  for (let s = 1; s <= horizon; s++) {
    mapeByStep[s] =
      cntByStep[s] > 0 ? Math.round((errByStep[s] / cntByStep[s]) * 10000) / 100 : null
    if (mapeByStep[s] !== null) {
      mapeSum += mapeByStep[s]
      mapeCnt++
    }
    smapeByStep[s] =
      smapeCntByStep[s] > 0
        ? Math.round((smapeSumByStep[s] / smapeCntByStep[s]) * 10000) / 100
        : null
    if (smapeByStep[s] !== null) {
      smapeSum += smapeByStep[s]
      smapeCnt++
    }
    picpByStep[s] =
      picpCntByStep[s] > 0
        ? Math.round((picpHitByStep[s] / picpCntByStep[s]) * 10000) / 10000
        : null
    picpHitTotal += picpHitByStep[s]
    picpCntTotal += picpCntByStep[s]
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
    smapeByStep,
    picpByStep,
    maseByStep,
    samplesByStep: cntByStep,
    origins: originCount,
    overallMape: mapeCnt > 0 ? Math.round((mapeSum / mapeCnt) * 100) / 100 : null,
    overallSmape: smapeCnt > 0 ? Math.round((smapeSum / smapeCnt) * 100) / 100 : null,
    overallPicp:
      picpCntTotal > 0 ? Math.round((picpHitTotal / picpCntTotal) * 10000) / 10000 : null,
    overallMase: maseCnt > 0 ? Math.round((maseSum / maseCnt) * 100) / 100 : null,
    series,
    memberScores,
    finalWeights,
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

/** 换模型的防抖门槛：MAPE 改善须 ≥0.5pp（提准方案 §P0-2），否则维持线性。 */
const SWITCH_MARGIN_PP = 0.5

/** 平局时的复杂度序（参数少者优先；组合无参数先验，排最后）。 */
const MODEL_PARAMS = {
  seasonal_naive: 12,
  linear: 15,
  ets: 18,
  combination: Number.POSITIVE_INFINITY,
}

/**
 * 闸门选优（导出供单测）。2026-10-04 P0-2 修正：季节朴素从"只当基准"升为候选胜者
 * （修前 10.22% 的线性模型压着一个已实现的 7.81% 朴素基准不换）。
 *
 * 规则：
 *  1. 线性是现任；候选须在滚动回测全步长平均 MAPE 上比线性好 ≥ SWITCH_MARGIN_PP
 *     （0.5pp）才可挑战；不达门槛一律保留线性（防抖）；
 *  2. 达标者取 MAPE 最小；平局按参数少者优先（季节朴素 12 < 线性 15 < ETS 18），
 *     保证同一输入下判据确定；
 *  3. 组合模型额外要求**严格优于当轮所有单模型**（Bates & Granger：组合须胜过最好成员，
 *     否则不参与竞争）；其分数由 lib/combination.cjs 的因果权重回测给出；
 *  4. 任何分数非有限（回测无样本）→ 该候选不参与；线性分数无效时一律保留线性。
 */
function selectModel(scores = {}) {
  const ok = (x) => x !== null && x !== undefined && Number.isFinite(x)
  const { linear, ets, seasonal_naive: sn, combination } = scores
  if (!ok(linear)) return 'linear'
  const singles = [linear, ets, sn].filter(ok)
  const bestSingle = singles.length ? Math.min(...singles) : Number.POSITIVE_INFINITY
  const eligible = []
  if (ok(ets) && linear - ets >= SWITCH_MARGIN_PP) eligible.push('ets')
  if (ok(sn) && linear - sn >= SWITCH_MARGIN_PP) eligible.push('seasonal_naive')
  if (ok(combination) && linear - combination >= SWITCH_MARGIN_PP && combination < bestSingle) {
    eligible.push('combination')
  }
  if (eligible.length === 0) return 'linear'
  eligible.sort((a, b) => scores[a] - scores[b] || MODEL_PARAMS[a] - MODEL_PARAMS[b])
  return eligible[0]
}

module.exports = {
  runRollingBacktest,
  seasonalNaiveModel,
  seasonalNaiveForecast,
  seasonalNaiveScale,
  selectModel,
  SWITCH_MARGIN_PP,
  addMonths,
  monthIndex,
  indexToTime,
}
