/**
 * 水位参数共享校验（前端侧）
 *
 * 与后端 backend/controllers/floodAnalysisController.js 的 validateWaterLevel
 * 保持同一契约：0–100 的有限数值。
 * 前端在发起请求前做快速校验，减少无效网络请求。
 */

/** 水位上限（米）—— 与后端 MAX_WATER_LEVEL 保持一致 */
export const MAX_WATER_LEVEL = 100

/** 水位下限（米） */
export const MIN_WATER_LEVEL = 0

/**
 * 校验水位参数是否合法
 * @param value - 待校验值
 * @returns 合法时返回 true
 */
export function isValidWaterLevel(value: unknown): value is number {
  const level = typeof value === 'string' ? parseFloat(value) : Number(value)
  return Number.isFinite(level) && level >= MIN_WATER_LEVEL && level <= MAX_WATER_LEVEL
}

/**
 * 校验水位并返回格式化错误信息（供 UI 提示）
 * @param value - 待校验值
 * @returns 错误信息，合法时返回 null
 */
export function validateWaterLevel(value: unknown): string | null {
  const level = typeof value === 'string' ? parseFloat(value) : Number(value)
  if (!Number.isFinite(level)) {
    return '水位参数必须为有效数字'
  }
  if (level < MIN_WATER_LEVEL || level > MAX_WATER_LEVEL) {
    return `水位参数需在 ${MIN_WATER_LEVEL}–${MAX_WATER_LEVEL} 米之间`
  }
  return null
}
