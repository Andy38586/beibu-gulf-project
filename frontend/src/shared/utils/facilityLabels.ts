/**
 * 设施中文标签映射：visualization 与 business 两层都需要，集中 shared 避免跨层依赖
 * （dependency-cruiser 规则 visualization-should-not-import-business 为 error 级）。
 * 业务逻辑（半径、权重等）仍在 business/site-selection/composables/facilityConfig.ts。
 */
export const FACILITY_LABELS: Record<string, string> = {
  hospital: '医院',
  primary_school: '小学',
  middle_school: '中学',
  park: '公园',
  bus_station: '公交站',
  mall: '商场',
}

/** 经济损失格式化：非法输入显示 '—'；基础单位万元，≥1 亿换算为亿 */
export function formatLoss(loss: number | undefined): string {
  const v = Number(loss)
  if (!isFinite(v)) return '—'
  if (v >= 10000) {
    return (v / 10000).toFixed(1) + '亿'
  }
  return v.toFixed(0) + '万'
}
