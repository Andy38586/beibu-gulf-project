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

/** 时间轴刻度年份：起止年与中点年（中点取整，与年步长同一域） */
export function timelineYears(): number[] {
  return [BASE_YEAR, Math.round((BASE_YEAR + END_YEAR) / 2), END_YEAR]
}

/**
 * 年份刻度在时间轴上的百分比位置（0–100）。
 * 年模式取年步、月模式取该年 1 月的月步，分母即当前粒度上限 maxSteps；
 * 换算经 currentTimeToStep 派生，不复制 (year-BASE_YEAR)*12 与年数差。
 */
export function yearMarkPosition(year: number, yearMode: boolean, maxSteps: number): number {
  return (currentTimeToStep(yearMode ? String(year) : `${year}-01`, yearMode) / maxSteps) * 100
}
