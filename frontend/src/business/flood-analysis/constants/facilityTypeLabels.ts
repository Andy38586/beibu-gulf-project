/**
 * 受影响设施类型展示词表：键必须与后端数据侧 type 一一对应
 * （权威源 = backend/data/flood/facilityPoints.json 的 facilities[].type），
 * 由 __tests__/facilityTypeLabels.test.ts 跨端核对——数据侧新增类型而本表未接入即红。
 * 曾经此处写成「泊位/码头/仓储区/油库」四键，与数据侧（港口码头/堆场/仓储/物流）
 * 命中 0/4，映射恒不生效。
 */

export const FACILITY_TYPE_LABELS: Record<string, string> = {
  港口码头: '港口码头',
  堆场: '堆场',
  仓储: '仓储',
  物流: '物流',
}

/** 设施类型展示标签：未登记的类型原样回显（不伪装成已知类型） */
export function getFacilityTypeLabel(type: string | undefined): string {
  if (!type) return ''
  return FACILITY_TYPE_LABELS[type] || type
}
