/**
 * 五准则单一事实源（新选址）：控制台卡片顺序、雷达图轴序、状态文案共用一份。
 * key 必须与 /site-suitability/map 响应的 properties 子分键一致（后端 score.constants 同源）。
 */
export type SuitabilityCriterionKey = 'inundation' | 'terrain' | 'land' | 'access' | 'demand'

interface SuitabilityCriterion {
  key: SuitabilityCriterionKey
  label: string
}

export const CRITERIA: readonly SuitabilityCriterion[] = [
  { key: 'inundation', label: '浸没安全' },
  { key: 'terrain', label: '地形施工' },
  { key: 'land', label: '土地适宜' },
  { key: 'access', label: '交通可达' },
  { key: 'demand', label: '产业需求' },
]
