// GCS 面板网格行高系数（三控制面板统一 0.8cell）。
//
// 历史注记（2026-10-11 D21-2 删）：本文件原有 panelGridCapacity 公式（c043，
// 按面板高度推导可完整呈现条目数，「超出走滚动出口」）。2026-09-30 容量规则
// 反转为「硬上限 8、超出截断 + DEV 报错」（PANEL_MAX_ROWS，钉在
// LayerControlPanel；红样见 LayerControlPanel.capacity.test.ts）——公式失去
// 全部消费方，按零调用即删（§十三-7）。ROW_HEIGHT_CELL 仍被四个面板消费，保留。
export const ROW_HEIGHT_CELL = 0.8
