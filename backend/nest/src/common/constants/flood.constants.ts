// 水位上限（米）：与 FastAPI 参数约束（le=25）及根基文档 02 §4.3 滑块范围一致
//（8-11：原 100 放宽越界），flood 模块入参与档位选取共用此界
export const MAX_WATER_LEVEL = 25

// 风险等级分段（六档语义：0 无 / 2 低 / 5 中 / 8 高 / 10 极高 / 15+ 灾难级）。
// 预计算档位表无 riskLevel 字段，由水位分段派生（02 §4.3）；阈值集中此处，
// 与 Express floodAnalysisController.js 及前端风险色档位同口径
export const RISK_LEVEL_BANDS = [
  { maxLevel: 0, label: '无风险' },
  { maxLevel: 2, label: '低风险' },
  { maxLevel: 5, label: '中风险' },
  { maxLevel: 8, label: '高风险' },
  { maxLevel: 10, label: '极高风险' },
  { maxLevel: Number.POSITIVE_INFINITY, label: '灾难级' },
] as const
