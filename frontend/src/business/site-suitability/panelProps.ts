import type { SiteSuitabilityResponseParsed } from '@/types/schemas'

/**
 * 三张只读面板（雷达 / 得分分布 / Top-N）共用 props 形状：
 * 页面透传同一份 /site-suitability/map 解析响应与请求进行态。
 */
export interface SiteSuitabilityPanelProps {
  /** /site-suitability/map 解析响应；null = 尚未取到数据 */
  data?: SiteSuitabilityResponseParsed | null
  /** 请求进行态：true 时显示加载态而非空态（面板文案各定） */
  loading?: boolean
}
