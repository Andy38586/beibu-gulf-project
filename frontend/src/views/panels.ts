// 本页面板清单：位置事实的唯一出处（模板只 v-bind，不写字面量）。
// 首页只有左列两块 4×4 图表（折线/柱状），无交互控制面板。
import { definePanels, type PanelSpec } from '@/shared'

export const HOME_PANELS: PanelSpec[] = definePanels([
  { id: 'trend', title: '港口吞吐量趋势', zone: 'left', order: 1, w: 4, h: 4, priority: 2 },
  { id: 'compare', title: '港口吞吐量对比', zone: 'left', order: 2, w: 4, h: 4, priority: 2 },
])
