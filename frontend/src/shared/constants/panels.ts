import type { PanelSpec } from '../layout/panelRegistry'

/** 各业务页共用的「图层控制」面板规格（右列第二块；diversion / site-suitability 同款） */
export const LAYERS_PANEL: PanelSpec = {
  id: 'layers',
  title: '图层控制',
  zone: 'right',
  order: 2,
  w: 4,
  h: 4,
  priority: 2,
}
