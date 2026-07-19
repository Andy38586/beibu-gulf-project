/**
 * 加载北部湾边界 GeoJSON 数据
 * 
 * AUDIT-GIS-002: 文件编码说明
 * - 文件编码：UTF-8（无 BOM）
 * - 浏览器 fetch 会自动处理 UTF-8 编码
 * - 如果在 PowerShell 终端调试，请使用：Get-Content file.geojson -Encoding UTF8
 * 
 * @param {Function} onError - 错误回调函数
 * @returns {Promise<Object|null>} GeoJSON 数据或 null
 */
export async function loadBoundaryGeoJson(onError) {
  try {
    const response = await fetch('/beibu-gulf-merged-data.geojson')
    if (!response.ok) {
      throw new Error('边界数据加载失败')
    }
    const geojson = await response.json()
    // AUDIT-015: 验证feature.properties存在性
    geojson.features.forEach((f) => {
      if (!f.properties) {
        f.properties = {}
      }
      f.properties.featureType = 'boundary'
    })
    return geojson
  } catch (error) {
    // AUDIT-017 (错误): 仅在开发环境输出错误
    if (import.meta.env.DEV) {
      console.error('边界数据加载失败:', error)
    }
    onError?.('边界数据加载失败，图层可能缺失')
    return null
  }
}

export const BOUNDARY_STYLE = {
  strokeColor: '#4dabf7',
  strokeWidth: 2,
  fillColor: 'rgba(77,171,247,0.15)',
  featureType: 'boundary',
}
