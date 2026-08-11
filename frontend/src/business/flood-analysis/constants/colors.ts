/**
 * 洪涝风险等级配色（仅洪水业务使用，从 shared 下沉到业务层）。
 * stroke: 边界线色；fill: 填充色（带透明度）
 */
export const FLOOD_RISK_COLORS: Record<string, { stroke: string; fill: string }> = {
  无风险: { stroke: '#909399', fill: 'rgba(144, 147, 153, 0.3)' },
  低风险: { stroke: '#67C23A', fill: 'rgba(103, 194, 58, 0.3)' },
  中风险: { stroke: '#E6A23C', fill: 'rgba(230, 162, 60, 0.3)' },
  高风险: { stroke: '#F56C6C', fill: 'rgba(245, 108, 108, 0.3)' },
  极高风险: { stroke: '#F56C6C', fill: 'rgba(245, 108, 108, 0.4)' },
  灾难级: { stroke: '#F56C6C', fill: 'rgba(245, 108, 108, 0.5)' },
}

export const FLOOD_RISK_DEFAULT = FLOOD_RISK_COLORS['无风险']
