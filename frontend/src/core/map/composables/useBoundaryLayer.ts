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
import { LAYER_DEFAULTS } from '@/shared'
import { loadStatic } from '@/shared'
import { logger } from '@/shared'
import type { LayerOptions } from '@/types'
import { boundaryCacheSchema } from '@/types/schemas'

export async function loadBoundaryGeoJson(
  onError?: (msg: string) => void
): Promise<FeatureCollection | null> {
  const CACHE_KEY = 'beibu-gulf-boundary-cache'
  const CACHE_EXPIRY = 24 * 60 * 60 * 1000 // 24小时缓存有效期
  const MAX_RETRIES = 3
  // z050-FE: sessionStorage 写入大小硬上限（500KB 字符），超限仅留内存层不持久化
  const SESSION_STORAGE_MAX_CHARS = 500_000

  // 检查缓存
  // z045: 用 boundaryCacheSchema.safeParse 替代裸 JSON.parse + as 断言；
  // 校验失败清缓存降级为重新 fetch（不抛错）
  try {
    const cached = sessionStorage.getItem(CACHE_KEY)
    if (cached) {
      const result = boundaryCacheSchema.safeParse(JSON.parse(cached))
      if (result.success && Date.now() - result.data.timestamp < CACHE_EXPIRY) {
        return result.data.data as FeatureCollection
      }
      if (!result.success) {
        logger.warn('[useBoundaryLayer] 缓存数据校验失败，已清除并重新拉取')
      }
      sessionStorage.removeItem(CACHE_KEY)
    }
  } catch {
    // 缓存读取失败，继续加载
  }

  // z032: 静态资源 fetch 收口 loadStatic（统一超时 10s + TTL 内存缓存），
  // 外层保留 3 次重试 + 线性退避（loadStatic 自身不重试，z049 仅作用于 useApiRequest）
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const geojson = await loadStatic<FeatureCollection>(MAP_CONFIG.DATA_PATHS.boundary)

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
        // z050-FE: 大小检查——边界数据 ~几十 KB，超 500KB 视为异常膨胀，仅留内存层
        const serialized = JSON.stringify({
          data: geojson,
          timestamp: Date.now(),
        })
        if (serialized.length > SESSION_STORAGE_MAX_CHARS) {
          logger.debug(
            `[useBoundaryLayer] 缓存条目过大 (${serialized.length} chars)，跳过 sessionStorage 持久化`
          )
        } else {
          sessionStorage.setItem(CACHE_KEY, serialized)
        }
      } catch {
        // 缓存写入失败不影响功能
      }

      return geojson
    } catch (error) {
      const e = error as Error
      const isLastAttempt = attempt === MAX_RETRIES

      if (import.meta.env.DEV) {
        logger.debug(`[useBoundaryLayer] 加载失败 (第${attempt}次):`, e.message)
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
  fillColor: LAYER_DEFAULTS.boundaryFill,
  featureType: 'boundary',
}
