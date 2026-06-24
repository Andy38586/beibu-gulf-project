// 把用户选的"重要程度"(1~5)换算成实际缓冲半径(公里)
// 每种设施类型的 defaultRadius (在 useFacilities.js 的 FACILITY_CONFIG 里) 作为"中等重要(3)"时的半径
// 1=完全不重要(其实不会被选中) 2=较不重要 3=一般 4=比较重要 5=非常重要
// 重要程度越高，意味着用户能接受的距离越大(愿意为了这个设施跑更远)，所以半径跟着放大
const IMPORTANCE_FACTOR = {
  1: 0.4,
  2: 0.7,
  3: 1.0,
  4: 1.5,
  5: 2.2,
}
export const IMPORTANCE_LABELS = {
  1: '不太在意',
  2: '稍微在意',
  3: '一般重要',
  4: '比较重要',
  5: '非常重要',
}
export function importanceToRadius(defaultRadius, importance) {
  const factor = IMPORTANCE_FACTOR[importance] ?? 1
  return Math.round(defaultRadius * factor * 10) / 10 // 保留1位小数
}
