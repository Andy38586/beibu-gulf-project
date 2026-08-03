/**
 * 设施配置常量
 * 定义各类设施的标签、颜色和默认缓冲区半径。
 * - color 字段统一引用 shared/constants/colors 的 FACILITY_COLORS_MAP（单一事实源）。
 * - label 字段引用 shared/utils/facilityLabels 的 FACILITY_LABELS（DAT-1：消除与
 * visualization 层重复的标签常量；business → shared 合法，不违反分层红线）。
 */

import { FACILITY_COLORS_MAP } from '@/shared'
import { FACILITY_LABELS } from '@/shared'
import type { FacilityConfigMap } from '@/types'

export const FACILITY_CONFIG: FacilityConfigMap = {
  hospital: {
    label: FACILITY_LABELS.hospital,
    color: FACILITY_COLORS_MAP.hospital,
    defaultRadius: 3,
  },
  primary_school: {
    label: FACILITY_LABELS.primary_school,
    color: FACILITY_COLORS_MAP.primary_school,
    defaultRadius: 1,
  },
  middle_school: {
    label: FACILITY_LABELS.middle_school,
    color: FACILITY_COLORS_MAP.middle_school,
    defaultRadius: 2,
  },
  park: {
    label: FACILITY_LABELS.park,
    color: FACILITY_COLORS_MAP.park,
    defaultRadius: 1.5,
  },
  bus_station: {
    label: FACILITY_LABELS.bus_station,
    color: FACILITY_COLORS_MAP.bus_station,
    defaultRadius: 0.5,
  },
  mall: {
    label: FACILITY_LABELS.mall,
    color: FACILITY_COLORS_MAP.mall,
    defaultRadius: 2,
  },
}
