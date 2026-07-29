/**
 * 设施配置常量
 *
 * 定义各类设施的标签、颜色和默认缓冲区半径
 *
 * color 字段统一引用 shared/constants/colors 的 FACILITY_COLORS_MAP，
 * 避免 business 与 visualization 各自维护一份色值（单一事实源）。
 */

import { FACILITY_COLORS_MAP } from '@/shared/constants/colors'
import type { FacilityConfigMap } from '@/types'

export const FACILITY_CONFIG: FacilityConfigMap = {
  hospital: {
    label: '医院',
    color: FACILITY_COLORS_MAP.hospital,
    defaultRadius: 3,
  },
  primary_school: {
    label: '小学',
    color: FACILITY_COLORS_MAP.primary_school,
    defaultRadius: 1,
  },
  middle_school: {
    label: '中学',
    color: FACILITY_COLORS_MAP.middle_school,
    defaultRadius: 2,
  },
  park: {
    label: '公园',
    color: FACILITY_COLORS_MAP.park,
    defaultRadius: 1.5,
  },
  bus_station: {
    label: '公交站',
    color: FACILITY_COLORS_MAP.bus_station,
    defaultRadius: 0.5,
  },
  mall: {
    label: '商场',
    color: FACILITY_COLORS_MAP.mall,
    defaultRadius: 2,
  },
}
