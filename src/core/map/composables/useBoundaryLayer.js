/**
 * 加载北部湾边界 GeoJSON 数据
 * 
 * AUDIT-GIS-002: 文件编码说明
 * - 文件编码：UTF-8（无 BOM）
 * - 浏览器 fetch 会自动处理 UTF-8 编码
 * - 如果在 PowerShell 终端调试，请使用：Get-Content file.geojson -Encoding UTF8
 * 
 * AUDIT-P01: 添加缓存机制和加载优化
 * - 使用 sessionStorage 缓存已加载的数据，避免重复请求
 * - 添加超时控制（10秒）
 * - 添加重试机制（最多3次）
 * 
 * @param {Function} onError - 错误回调函数
 * @returns {Promise<Object|null>} GeoJSON 数据或 null
 */
export async function loadBoundaryGeoJson(onError) {
  const CACHE_KEY = 'beibu-gulf-boundary-cache'
  const CACHE_EXPIRY = 24 * 60 * 60 * 1000 // 24小时缓存有效期
  const MAX_RETRIES = 3
  const TIMEOUT_MS = 10000

  // AUDIT-P01: 检查缓存
  try {
    const cached = sessionStorage.getItem(CACHE_KEY)
    if (cached) {
      const { data, timestamp } = JSON.parse(cached)
      if (Date.now() - timestamp < CACHE_EXPIRY) {
        // AUDIT-006: 移除调试日志，仅在开发环境输出
        if (import.meta.env.DEV) {
          console.log('[useBoundaryLayer] 使用缓存的边界数据')
        }
        return data
      }
    }
  } catch {
    // 缓存读取失败，继续加载
  }

  // AUDIT-P01: 带重试和超时的加载
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

      const response = await fetch('/beibu-gulf-merged-data.geojson', {
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error('边界数据加载失败')
      }

      const geojson = await response.json()
      
      // 防御性检查：确保 features 数组存在
      if (!Array.isArray(geojson.features)) {
        throw new Error('GeoJSON 格式无效：缺少 features 数组')
      }

      // AUDIT-015: 验证feature.properties存在性
      geojson.features.forEach((f) => {
        if (!f.properties) {
          f.properties = {}
        }
        f.properties.featureType = 'boundary'
      })

      // AUDIT-P01: 缓存数据
      try {
        sessionStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ data: geojson, timestamp: Date.now() })
        )
      } catch {
        // 缓存写入失败不影响功能
      }

      return geojson
    } catch (error) {
      const isTimeout = error.name === 'AbortError'
      const isLastAttempt = attempt === MAX_RETRIES

      if (import.meta.env.DEV) {
        console.warn(
          `[useBoundaryLayer] 加载失败 (第${attempt}次):`,
          isTimeout ? '超时' : error.message
        )
      }

      if (isLastAttempt) {
        // AUDIT-017 (错误): 仅在开发环境输出错误
        if (import.meta.env.DEV) {
          console.error('边界数据加载失败:', error)
        }
        onError?.('边界数据加载失败，图层可能缺失')
        return null
      }

      // 等待后重试（线性退避：1s, 2s, 3s）
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
    }
  }

  return null
}

export const BOUNDARY_STYLE = {
  strokeColor: '#4dabf7',
  strokeWidth: 2,
  fillColor: 'rgba(77,171,247,0.15)',
  featureType: 'boundary',
}
