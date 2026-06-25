const IMPORTANCE_FACTOR = {
  1: 0.4,
  2: 0.7,
  3: 1.0,
  4: 1.5,
  5: 2.2,
}
export function importanceToRadius(defaultRadius, importance) {
  const factor = IMPORTANCE_FACTOR[importance] ?? 1
  return Math.round(defaultRadius * factor * 10) / 10
}
