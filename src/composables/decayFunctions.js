export const linearDecay = (distance, maxDistance) => {
  if (distance >= maxDistance) return 0
  return (1 - distance / maxDistance) * 100
}
export const exponentialDecay = (distance, maxDistance) => {
  if (distance >= maxDistance) return 0
  return 100 * Math.exp((-3 * distance) / maxDistance)
}
export const steppedDecay = (distance, maxDistance) => {
  const ratio = distance / maxDistance
  if (ratio >= 1) return 0
  if (ratio <= 0.3) return 100
  return ((1 - ratio) / 0.7) * 100
}
export const DECAY_FUNCTIONS = {
  linear: { label: '线性衰减', fn: linearDecay },
  exponential: { label: '指数衰减', fn: exponentialDecay },
  stepped: { label: '分段衰减', fn: steppedDecay },
}
