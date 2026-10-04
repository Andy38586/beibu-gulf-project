// 北部湾业务范围（EPSG:4326 经纬度）：设施/小区数据筛选与落图的统一边界。
// 历史：Express siteAnalysisService.js 与 Nest 侧原在此各硬编码两次（105/115/18/25），
// 集中为单一事实源后，改范围只动此文件；前端/算法侧如有对照以本常量为准
export const GULF_BOUNDS = {
  minLng: 105,
  maxLng: 115,
  minLat: 18,
  maxLat: 25,
} as const
