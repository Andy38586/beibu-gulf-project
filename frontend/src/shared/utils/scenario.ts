/**
 * 预测/运河情景查询参数助手（map / timeseries / indicator 对比三处共用；
 * baseline 缺省不发，与后端 parseScenarioId 的缺省回落口径一致）。
 *
 * D21-5 收口：原为 business/queryParams.ts 与 services/forecastAdapter 两份手抄，
 * 且判定口径不同（business 按 !=='baseline'，adapter 按 truthy）——同一条
 * 「缺省不发 scenario」契约两处实现，取值集演进时会静默漂移。分层约束下
 * services 不得 import business，故落 shared 供两侧同源引用。
 */
export function scenarioParam(scenario?: string): Record<string, string> {
  return scenario && scenario !== 'baseline' ? { scenario } : {}
}
