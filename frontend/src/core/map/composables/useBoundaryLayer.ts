/**
 * 加载北部湾边界 GeoJSON（静态资源，UTF-8 无 BOM）：
 * sessionStorage 缓存（24h）+ 10s 超时 + 3 次线性退避重试。
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
  // sessionStorage 写入大小硬上限（500KB 字符），超限仅留内存层不持久化
  const SESSION_STORAGE_MAX_CHARS = 500_000

  // 读缓存：schema 校验失败则清缓存重新 fetch（不抛错）
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

  // 静态资源 fetch 收口 loadStatic（统一超时 + TTL 内存缓存），
  // 外层保留 3 次重试 + 线性退避（loadStatic 自身不重试）
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const geojson = await loadStatic<FeatureCollection>(MAP_CONFIG.DATA_PATHS.boundary)

      // 防御性检查：确保 features 数组存在
      if (!Array.isArray(geojson.features)) {
        throw new Error('GeoJSON 格式无效：缺少 features 数组')
      }

      // 确保 feature.properties 存在并打上边界要素类型标记
      geojson.features.forEach((f) => {
        if (!f.properties) {
          f.properties = {}
        }
        f.properties.featureType = 'boundary'
      })

      // 缓存数据（超 500KB 视为异常膨胀，仅留内存层）
      try {
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
