/**
 * 雷达图默认展示快照数据（UI fallback 常量，非真实业务数据源）。
 *
 * ⚠️ 定位与边界：
 * - 用途：仅在「未选择小区 / 无分析结果」时填充雷达图，避免空态——是展示兜底，不是后端数据。
 * - 数值来自 2026-08 后端一次实测快照（6 设施 × importance=3 的第一名小区"腾龙阁"）。
 * - 约束：后端评分口径/数据变化后，此快照会与真实结果失真。因此它**只应作为 fallback**，
 *   不得被当作"当前真实第一名的数据"消费；真实数据一律来自 /site-analysis 接口返回。
 * - 改它不改变任何面板文字或 toast，仅影响未分析时的雷达图形。
 */

import type { FacilityType } from '@/types/facility'
import type { ScoredXiaoqu } from '@/types/xiaoqu'

/** 快照所用设施类型（对应 SiteAnalysisControlPanel 全部 6 类） */
export const SNAPSHOT_SELECTED_TYPES: FacilityType[] = [
  'hospital',
  'primary_school',
  'middle_school',
  'park',
  'bus_station',
  'mall',
]

/** 快照小区：腾龙阁小区（6 设施 × importance=3 评分第一名，score 85.2）。仅 UI fallback 用。 */
export const SNAPSHOT_XIAOQU: ScoredXiaoqu = {
  id: 'B0L2PRR3L7',
  name: '腾龙阁小区',
  lng: 108.618109,
  lat: 21.950412,
  score: 85.2,
  breakdown: {
    hospital: 92.6,
    primary_school: 82.5,
    middle_school: 84.1,
    park: 85.2,
    bus_station: 74.4,
    mall: 87.4,
  },
}
