/**
 * 春节移动假期修正（X-13 regARIMA 节前日数法的简化变体）——纯函数，确定性。
 *
 * 解决的问题：春节公历日期逐年移动（1/21~2/20），法定假期落在 1 月还是 2 月逐年不同，
 * 月索引式季节因子把这种错位平均掉，导致 1/2 月季节指数系统性失真。
 *
 * 方法（04-B10 口径，实现即本文档）：
 *   - h(m,y) = 该年春节法定假期窗口与月份 m 的重叠天数（窗口表 CNY_WINDOWS）
 *   - 有效假期日 hEff = (1−k)·h，k = 假期日保留活动比例，默认 0（假期日按零活动计——
 *     港口作业假期不完全停止，k=0 属保守高估修正，敏感性可调参重跑）
 *   - 基准 h̄_m = 样本内该月 hEff 的均值（仅 1/2 月可能 >0，其余月恒 0）
 *   - 调整（历史）：y' = y × (days(m) − h̄_m) / (days(m) − hEff(m,y))
 *   - 逆变换（预测）：ŷ = ŷ' × (days(m) − hEff(m,y)) / (days(m) − h̄_m)  ← 纯日历确定性
 *
 * 假期窗口表依据：国务院历年春节假期安排（2021-2024 年 7 天、2025 起含除夕 8 天）；
 * 2027-2036 为农历初一对应公历日期推算（初一起算 8 天窗口假设），仅用于预测逆变换的
 * 缓慢变化因子，个别年份 ±1 天偏差对因子的扰动 <1%，不构成口径风险；覆盖至 2036（预测期 2035-12 内）。
 */
'use strict'

// 每年春节假期窗口：[起始日 'MM-DD'（含），天数]
const CNY_WINDOWS = {
  2021: ['02-11', 7],
  2022: ['01-31', 7],
  2023: ['01-21', 7],
  2024: ['02-10', 8],
  2025: ['01-28', 8],
  2026: ['02-15', 8],
  2027: ['02-05', 8],
  2028: ['01-25', 8],
  2029: ['02-12', 8],
  2030: ['02-02', 8],
  2031: ['01-22', 8],
  2032: ['02-10', 8],
  2033: ['01-30', 8],
  2034: ['02-18', 8],
  2035: ['02-07', 8],
  2036: ['01-27', 8],
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function parseTime(timeStr) {
  const [y, m] = timeStr.split('-').map(Number)
  return { year: y, month: m }
}

/** 该年春节假期与指定月份的重叠天数（无窗口年份 = 0；窗口跨月时两月各计各的） */
function holidayDaysInMonth(timeStr) {
  const { year, month } = parseTime(timeStr)
  const win = CNY_WINDOWS[year]
  if (!win) return 0
  const [startMMDD, len] = win
  const [sm, sd] = startMMDD.split('-').map(Number)
  // 把窗口逐日展开，数落在指定月份的天数（窗口跨月时自然拆分）
  let count = 0
  let cm = sm
  let cd = sd
  for (let i = 0; i < len; i++) {
    if (cm === month) count++
    cd++
    if (cd > daysInMonth(year, cm)) {
      cm++
      cd = 1
    }
  }
  return count
}

/**
 * 构建修正上下文（h̄_m 由传入样本计算——回测内仅用训练段，防信息泄漏）。
 * @param {string[]} times 'YYYY-MM' 数列（历史样本）
 * @param {{k?: number}} opts k = 假期日保留活动比例（默认 0）
 */
function buildCnyContext(times, { k = 0 } = {}) {
  const sumByMonth = {}
  const cntByMonth = {}
  for (const t of times) {
    const { month } = parseTime(t)
    const hEff = (1 - k) * holidayDaysInMonth(t)
    sumByMonth[month] = (sumByMonth[month] || 0) + hEff
    cntByMonth[month] = (cntByMonth[month] || 0) + 1
  }
  const hBar = {}
  for (let m = 1; m <= 12; m++) {
    hBar[m] = cntByMonth[m] ? sumByMonth[m] / cntByMonth[m] : 0
  }

  function factor(timeStr, mode) {
    const { year, month } = parseTime(timeStr)
    const dm = daysInMonth(year, month)
    const hEff = (1 - k) * holidayDaysInMonth(timeStr)
    const base = dm - hBar[month]
    const actual = dm - hEff
    if (base <= 0 || actual <= 0) return 1 // 数学上不可达（假期 ≤8 天 < 月天数），防御性直通
    return mode === 'adjust' ? base / actual : actual / base
  }

  return {
    /** 历史值 → 修正空间 */
    adjustValue: (timeStr, v) => v * factor(timeStr, 'adjust'),
    /** 修正空间预测值 → 原空间（日历确定性，预测期年份须在 CNY_WINDOWS 内） */
    invertValue: (timeStr, v) => v * factor(timeStr, 'invert'),
    /** 调试用：各月基准假期日 */
    holidayBaseline: () => ({ ...hBar }),
  }
}

module.exports = { CNY_WINDOWS, buildCnyContext, holidayDaysInMonth, daysInMonth }
