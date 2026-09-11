import { BASE_YEAR, END_YEAR } from '@/shared'

/**
 * 预测时间轴 步数 ↔ 时间串 换算（年/月双粒度共用一个步长索引）。
 * 两种粒度的时间基不同：年模式步长=年，月模式步长=月。历史上直接共用
 * currentTime 切分逻辑，年模式产出的无月份串（"2025"）切回月模式时
 * m=undefined → currentStep=NaN，穿透播放守卫死循环（审查 H-3）。
 * 换算收口此处：m 缺省兜 1（年串切月 = 该年 1 月），任何合法输入不产生 NaN。
 */

/** 年模式步数上限（END_YEAR - BASE_YEAR + 1 个年份，步 0..N-1） */
export function yearMaxSteps(): number {
  return END_YEAR - BASE_YEAR
}

/** 月模式步数上限（=2031-12 闭合， 原 (END_YEAR-BASE_YEAR+1)*12 会越界到 2032-01） */
export function monthMaxSteps(): number {
  return (END_YEAR - BASE_YEAR) * 12 + 11
}

/**
 * currentTime → 当前步。
 * @param currentTime 年模式为 "YYYY"，月模式为 "YYYY-MM"
 * @param yearMode    当前粒度（年串在月模式下 m 缺省按 1 月计）
 */
export function currentTimeToStep(currentTime: string, yearMode: boolean): number {
  const [y, m] = currentTime.split('-').map(Number)
  return yearMode ? y - BASE_YEAR : (y - BASE_YEAR) * 12 + ((m ?? 1) - 1)
}

/** 步 → 时间串：年模式产出 "YYYY"，月模式产出 "YYYY-MM"（01-12 补零） */
export function stepToTime(step: number, yearMode: boolean): string {
  if (yearMode) return String(BASE_YEAR + step)
  return `${BASE_YEAR + Math.floor(step / 12)}-${String((step % 12) + 1).padStart(2, '0')}`
}
