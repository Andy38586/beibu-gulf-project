// 面板注册表：位置与尺寸的事实单源（布局层通用形状）。
// 为什么是注册表：面板 id/列/顺序/宽高此前散落在页面模板的字面量里，
// 新增面板靠记忆找位置；事实应进数据，约束应进断言。
// 本文件只收通用形状，不收任何页面清单（页面清单归各自归属层声明）。
export type PanelZone = 'left' | 'right'

export interface PanelSpec {
  id: string
  title: string
  zone: PanelZone
  order: number
  /** 宽（格），必须为 SUBCELL 的整数倍 */
  w: number
  /** 高（格），必须为 SUBCELL 的整数倍 */
  h: number
  /** 1 = 紧凑档优先保留 */
  priority: 1 | 2 | 3
  collapsible?: boolean
  defaultCollapsed?: boolean
}

/** 偏移允许刻度：整数 × SUBCELL（旧模板 1.25 之类非倍数字面量在此非法） */
const SUBCELL = 0.5

/** 尺寸非法即抛（注册期拒绝，不靠注释提醒） */
export function assertCellMultiple(value: number, what: string): void {
  const ratio = value / SUBCELL
  if (!Number.isFinite(value) || Math.abs(ratio - Math.round(ratio)) > 1e-9) {
    throw new Error(`${what}=${value} 不是 ${SUBCELL} 的整数倍（面板尺寸只允许整数×SUBCELL）`)
  }
}

export function definePanels(specs: PanelSpec[]): PanelSpec[] {
  const seen = new Set<string>()
  for (const s of specs) {
    if (seen.has(s.id)) throw new Error(`面板 id 重复: ${s.id}`)
    seen.add(s.id)
    assertCellMultiple(s.w, `${s.id}.w`)
    assertCellMultiple(s.h, `${s.id}.h`)
  }
  return specs.map((s) => ({ collapsible: true, ...s }))
}
