/**
 * 预测接口查询参数助手（map / timeseries 两处共用；baseline 缺省不发，
 * 与后端 parseScenarioId 的缺省回落口径一致）。
 */
export function scenarioParam(scenario: string): { scenario?: string } {
  return scenario !== 'baseline' ? { scenario } : {}
}
