// 本页面板清单：位置事实的唯一出处（模板只 v-bind，不写字面量）。
// 两列各两块 4×4（与旧模板一致）；control 为紧凑档优先保留。
import { definePanels, type PanelSpec } from '@/shared'
import { LAYERS_PANEL } from '@/shared/constants/panels'

export const SITE_SUITABILITY_PANELS: PanelSpec[] = definePanels([
  { id: 'radar', title: '得分分布雷达', zone: 'left', order: 1, w: 4, h: 4, priority: 2 },
  { id: 'candidates', title: '候选格名单', zone: 'left', order: 2, w: 4, h: 4, priority: 2 },
  { id: 'control', title: '适宜性控制', zone: 'right', order: 1, w: 4, h: 4, priority: 1 },
  LAYERS_PANEL,
])
