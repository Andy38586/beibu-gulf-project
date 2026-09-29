// 选址适宜性评分归一化口径（单元四；v1 全部为**待定夺草案**——阈值属论文取舍，
// 与 AHP 判断矩阵同批由用户定稿；本文件只固化「可复算的草案」并逐条挂依据。
// 评分语义：全部为 [0,1] 的**适宜度**（越大越适宜），浸没风险取其补（安全余量）。

/** 土地覆盖类 → 适宜度（WorldCover PUM 类码）。待定夺：临港产业口径下
 * 人造地表直接可用、耕地次之（转用成本）、林地/湿地/红树林受生态约束； */
export const LAND_CLASS_SCORE: Readonly<Record<number, number>> = {
  50: 1.0, // 人造地表
  60: 0.8, // 裸地
  40: 0.6, // 耕地
  30: 0.5, // 草地
  20: 0.45, // 灌木
  10: 0.35, // 乔木林
  70: 0.2, // 冰雪
  100: 0.2, // 苔藓
  90: 0.15, // 湿地
  95: 0.1, // 红树林（保护地）
  80: 0.0, // 水体
}

/**
 * 浸没安全适宜度 ← mean_elev（EGM96 正高，与 flood_levels 档位同基准经 datumOffset）。
 * 分段（待定夺，锚点：沿海设计高水位约 +2m、风暴潮增水历史约 +2m、工程安全超高 1m）：
 * ≤1m → 0.05（潮滩/极高潮位即淹）；1~6m 线性升至 1.0；>6m → 1.0。
 */
export function inundationScore(meanElevM: number): number {
  const t = Math.min(1, Math.max(0, (meanElevM - 1) / 5))
  return 0.05 + t * 0.95
}

/**
 * 地形施工适宜度 ← mean_slope（度）。
 * 分段（待定夺，锚点：港口陆域场地平整一般要求 ≤3°；>15° 土方成本急剧上升）：
 * ≤3° → 1.0；3~15° 线性降至 0.1；>15° → 0.1。
 */
export function terrainScore(meanSlopeDeg: number): number {
  if (meanSlopeDeg <= 3) return 1
  if (meanSlopeDeg >= 15) return 0.1
  return 1 - ((meanSlopeDeg - 3) / 12) * 0.9
}

/**
 * 交通可达适宜度 ← 到港/到路球面距离（米）。
 * 指数衰减（待定夺，尺度锚点：港口 10km 集疏运圈、道路 2km 接入圈）：
 * 0.6·exp(−d_port/8000) + 0.4·exp(−d_road/2000)。
 */
export function accessScore(distPortM: number, distRoadM: number): number {
  return 0.6 * Math.exp(-distPortM / 8000) + 0.4 * Math.exp(-distRoadM / 2000)
}
