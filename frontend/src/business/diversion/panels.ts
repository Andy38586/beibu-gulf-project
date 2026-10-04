// 本页面板清单：位置事实的唯一出处（模板只 v-bind，不写字面量）。
// 左列：转移量图（上）、桑基图（下）；右列：年份卡片（上）、图层面板（下）。
// year 取 priority 1：紧凑档只保留它（年份是本页唯一的交互输入）。
import { definePanels, type PanelSpec } from '@/shared'

export const DIVERSION_PANELS: PanelSpec[] = definePanels([
  { id: 'transfer', title: '西江→运河转移量', zone: 'left', order: 1, w: 4, h: 4, priority: 2 },
  { id: 'sankey', title: '转移流向', zone: 'left', order: 2, w: 4, h: 4, priority: 2 },
  { id: 'year', title: '年份', zone: 'right', order: 1, w: 4, h: 4, priority: 1 },
  { id: 'layers', title: '图层控制', zone: 'right', order: 2, w: 4, h: 4, priority: 2 },
])
