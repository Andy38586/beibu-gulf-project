/**
 * 坐标回落文案（槽位 / 暂存点 / 航段名三处共用）。
 *
 * 4 位小数 ≈ 11m：足以区分港区内的两个泊位，又不会把浮点尾巴带上屏。
 * 此前三处各写各的（两处 4 位、一处 3 位 ≈111m），同一坐标在面板与航段名里
 * 精度不同且无任何提示；收成一处后改精度只改这里。
 */
export function formatLngLat(p: { lng: number; lat: number }): string {
  return `${p.lng.toFixed(4)}, ${p.lat.toFixed(4)}`
}
