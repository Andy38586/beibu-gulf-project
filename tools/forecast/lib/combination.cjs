/**
 * 组合预测（L3）：多模型预测的加权组合。
 *
 * 依据：【硬锚】Bates & Granger (1969) 组合预测；组合对单模型误差结构互补时
 * 常优于最好的单模型——M 竞赛反复验证。权重协议属【作者设定】：
 *
 * ## 因果（防泄漏）
 * 权重只由**已实现**误差决定：WeightTracker 逐 origin 喂入各模型"到此为止"的
 * 已实现误差，未喂过的模型不参与加权——首个 origin 等权起步，随后按
 * 1/误差收敛（inverse 法）。任何"用未来回测结果定权重"的写法都是变相泄漏，
 * 04-B10 协议在本层同样适用。
 *
 * ## 方法
 * - 'inverse'：w_i ∝ 1/score_i（score > 0 且有限才参与；其余剔除后权重重归一）
 * - 'mean'：参与模型等权
 */
'use strict'

/** 等权（参与模型均分）；空集返回 {} */
function equalWeights(validKeys) {
  const weights = {}
  for (const k of validKeys) weights[k] = 1 / validKeys.length
  return weights
}

/**
 * 由各模型已实现分数（越小越好，如 overallMape/overallSmape）得组合权重。
 * 非有限/非正分数的模型剔除；剔除后至少留一个模型（全剔除时等权兜底）。
 */
function combinationWeights(scores, method = 'inverse') {
  const keys = Object.keys(scores)
  if (method === 'mean') return equalWeights(keys)
  const valid = keys.filter((k) => Number.isFinite(scores[k]) && scores[k] > 0)
  if (valid.length === 0) return keys.length ? equalWeights(keys) : {}
  const total = valid.reduce((a, k) => a + 1 / scores[k], 0)
  const weights = {}
  for (const k of valid) weights[k] = 1 / scores[k] / total
  return weights
}

/**
 * 单时点组合预测：predictions = [{key, value|null}]。
 * null/非有限预测的模型剔除，其权重并入余下模型重归一（不是丢弃质量）；
 * 全部无效 → null（该时点无组合预测，回测按无样本跳过）。
 */
function combinePredictions(predictions, weights) {
  const valid = predictions.filter(
    (p) => p && Number.isFinite(p.value) && Number.isFinite(weights[p.key])
  )
  if (valid.length === 0) return null
  const wTotal = valid.reduce((a, p) => a + weights[p.key], 0)
  if (!(wTotal > 0)) return null
  return valid.reduce((a, p) => a + p.value * (weights[p.key] / wTotal), 0)
}

/**
 * 因果权重跟踪器：逐 origin 用各模型**已实现**误差更新；
 * weights() 只反映已喂入的数据（首个 origin 等权——无历史时无偏倚起点）。
 * scores 形如 { 模型key: 已实现overallMape }，每次 update 整体替换该快照。
 */
function createWeightTracker(method = 'inverse') {
  let latest = null
  return {
    /** 喂入截至当前 origin 的已实现分数快照（只喂过去，调用方保证因果） */
    update(scores) {
      latest = { ...scores }
    },
    /** 当前权重（未喂过 → null，调用方应走等权组合） */
    weights() {
      return latest === null ? null : combinationWeights(latest, method)
    },
  }
}

module.exports = { combinationWeights, combinePredictions, createWeightTracker }
