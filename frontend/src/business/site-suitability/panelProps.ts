import type { SiteSuitabilityResponseParsed } from '@/types/schemas'

/**
 * 选址面板的 props 形状：页面透传 /site-suitability/map 解析响应与请求进行态。
 *
 * 2026-10-12 修（A1 发现）：原注释称「**三张**只读面板（雷达 / 得分分布 / Top-N）共用」，
 * 实测**仅 SuitabilityRadarPanel 一个消费者**（全仓唯一 `defineProps<SiteSuitabilityPanelProps>`），
 * 得分分布 / Top-N 面板已不在或已改用别处形状 ⇒ 原注释是失实文档（K1 H1）。
 * 若日后确无第二个消费者，本文件可整体内联回组件（收口），本笔只先纠正失实。
 */
export interface SiteSuitabilityPanelProps {
  /** /site-suitability/map 解析响应；null = 尚未取到数据 */
  data?: SiteSuitabilityResponseParsed | null
  /** 请求进行态：true 时显示加载态而非空态（面板文案各定） */
  loading?: boolean
}
