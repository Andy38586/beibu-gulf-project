export const linearDecay = (distance, maxDistance) => {
  if (distance >= maxDistance) return 0
  return (1 - distance / maxDistance) * 100
}
