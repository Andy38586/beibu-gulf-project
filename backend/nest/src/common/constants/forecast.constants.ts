// 情景系数边界：非有限/≤0 回退默认 1.0，上限 2——避免异常值经 Math.pow 产出 Infinity/NaN。
// 前端 UI 滑块限 0.8-1.2（设计语义），API 手工传 >1.2 属「有界放大」测试通道
export const DEFAULT_CONFIDENCE = 1.0
export const MAX_CONFIDENCE = 2
