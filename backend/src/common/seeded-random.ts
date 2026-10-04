/**
 * 固定种子 LCG（Park-Miller 线性同余）：业务数值禁 Math.random 的统一实现。
 * 同一 seed 恒同序列；seed 的确定性由调用方负责（如 timePoint+索引哈希）。
 */
export function seededRandom(seed: number): () => number {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}
