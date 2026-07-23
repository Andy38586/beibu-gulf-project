const IMPORTANCE_FACTOR = {
  1: 0.4,
  2: 0.7,
  3: 1.0,
  4: 1.5,
  5: 2.2,
}

// BUGFIX-P3-10: 非表项输入取整夹取并告警，拒绝静默兜底
function importanceToFactor(importance) {
  const raw = Number(importance)
  const n = Math.round(raw)
  if (!isFinite(raw) || n < 1 || n > 5) {
    console.warn(`[importanceMapping] 无效 importance: ${importance}，已按 3 处理`)
    return IMPORTANCE_FACTOR[3]
  }
  if (n !== raw) {
    console.warn(`[importanceMapping] importance ${importance} 非整数，已取整为 ${n}`)
  }
  return IMPORTANCE_FACTOR[n]
}

export function importanceToRadius(defaultRadius, importance) {
  const factor = importanceToFactor(importance)
  return Math.round(defaultRadius * factor * 10) / 10
}
