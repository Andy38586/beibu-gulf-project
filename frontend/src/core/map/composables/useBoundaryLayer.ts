/**
 * 加载北部湾边界 GeoJSON 数据
 *
 * 文件编码说明
 * - 文件编码：UTF-8（无 BOM）
 * - 浏览器 fetch 会自动处理 UTF-8 编码
 * - 如果在 PowerShell 终端调试，请使用：Get-Content file.geojson -Encoding UTF8
 *
 * 添加缓存机制和加载优化
 * - 使用 sessionStorage 缓存已加载的数据，避免重复请求
 * - 添加超时控制（10秒）
 * - 添加重试机制（最多3次）
 *
 * @param {Function} onError - 错误回调函数
 * @returns {Promise<Object|null>} GeoJSON 数据或 null
 */
import type { FeatureCollection } from 'geojson'

import { MAP_CONFIG } from '@/core/config/map'
import { LAYER_DEFAULTS } from '@/shared/constants/colors'
import { logger } from '@/shared/utils/logger'
import type { LayerOptions } from '@/types'

export async function loadBoundaryGeoJson(
  onError?: (msg: string) => void
): Promise<FeatureCollection | null> {
  const CACHE_KEY = 'beibu-gulf-boundary-cache'
  const CACHE_EXPIRY = 24 * 60 * 60 * 1000 // 24小时缓存有效期
  const MAX_RETRIES = 3
  const TIMEOUT_MS = 10000

  // 检查缓存
  try {
    const cached = sessionStorage.getItem(CACHE_KEY)
    if (cached) {
      const { data, timestamp } = JSON.parse(cached)
      if (Date.now() - timestamp < CACHE_EXPIRY) {
        return data
      }
    }
  } catch {
    // 缓存读取失败，继续加载
  }

  // 带重试和超时的加载
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

      const response = await fetch(MAP_CONFIG.DATA_PATHS.boundary, {
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error('边界数据加载失败')
      }

      const geojson: FeatureCollection = await response.json()

      // 防御性检查：确保 features 数组存在
      if (!Array.isArray(geojson.features)) {
        throw new Error('GeoJSON 格式无效：缺少 features 数组')
      }

      // 验证feature.properties存在性
      geojson.features.forEach((f) => {
        if (!f.properties) {
          f.properties = {}
        }
        f.properties.featureType = 'boundary'
      })

      // 缓存数据
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data: geojson, timestamp: Date.now() }))
      } catch {
        // 缓存写入失败不影响功能
      }

      return geojson
    } catch (error) {
      const e = error as Error
      const isTimeout = e.name === 'AbortError'
      const isLastAttempt = attempt === MAX_RETRIES

      if (import.meta.env.DEV) {
        logger.debug(
          `[useBoundaryLayer] 加载失败 (第${attempt}次):`,
          isTimeout ? '超时' : e.message
        )
      }

      if (isLastAttempt) {
        // 仅在开发环境输出错误
        logger.error('边界数据加载失败:', e)
        onError?.('边界数据加载失败，图层可能缺失')
        return null
      }

      // 等待后重试（线性退避：1s, 2s, 3s）
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
    }
  }

  return null
}

export const BOUNDARY_STYLE: LayerOptions = {
  strokeColor: LAYER_DEFAULTS.stroke,
  strokeWidth: 2,
  fillColor: 'rgba(77,171,247,0.15)',
  featureType: 'boundary',
}
