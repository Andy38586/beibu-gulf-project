/**
 * useTerrainProfiles — 地形剖面线数据 composable（816-专项1 发现16：R5 收口，取数逻辑出组件）
 * 请求走统一入口 apiRequest + zod schema 校验；AbortSignal 由调用方传入（组件卸载时 abort，
 * 迟到响应不写回已卸载组件）。组件只消费 profiles/selectedProfileId 并触发加载。
 */
import { type Ref, ref } from 'vue'

import { ENDPOINTS, logger, showError, useApiRequest } from '@/shared'
import { terrainProfileSchema } from '@/types/schemas'

/** 剖面线点（对应 terrainProfile.json points） */
export interface TerrainProfilePoint {
  distance: number
  lng: number
  lat: number
  elevation: number
}

/** 剖面线（对应 terrainProfile.json profiles；startPoint/endPoint 数据自带，当前零消费） */
export interface TerrainProfile {
  id: string
  name: string
  port?: string
  description?: string
  points: TerrainProfilePoint[]
  startPoint?: { lng: number; lat: number }
  endPoint?: { lng: number; lat: number }
  /**
   * 垂直基准偏移：水位(理论深度基准面) - datumOffset = 剖面高程基准(EGM96 正高)。
   * 由后端从 waterLevel.json(baseLevels.msl) 透传，前端水面线须换算后与地形同基准绘制。
   */
  datumOffset?: number
}

/** 返回契约（816-专项3-0816-13：显式化） */
export interface UseTerrainProfilesReturn {
  profiles: Ref<TerrainProfile[]>
  selectedProfileId: Ref<string | null>
  loadProfiles: (signal?: AbortSignal) => Promise<void>
  getCurrentProfile: () => TerrainProfile | undefined
}

export function useTerrainProfiles(): UseTerrainProfilesReturn {
  const { apiRequest } = useApiRequest()

  const profiles = ref<TerrainProfile[]>([])
  const selectedProfileId = ref<string | null>(null)

  /** 从后端加载全部预设剖面线（signal 传组件级 AbortController，卸载取消） */
  async function loadProfiles(signal?: AbortSignal): Promise<void> {
    try {
      const result = await apiRequest<TerrainProfile[]>(ENDPOINTS.flood.terrainProfiles, {
        schema: terrainProfileSchema,
        signal,
      })

      if (result && Array.isArray(result)) {
        profiles.value = result
        // 默认选择第一条剖面线（仅本地 ref）
        if (profiles.value.length > 0) {
          selectedProfileId.value = profiles.value[0].id
        }
      } else {
        showError('加载剖面线数据失败')
      }
    } catch (error) {
      // 主动取消（卸载）静默——迟到的取消错误不弹 toast
      if (signal?.aborted) return
      logger.error('加载剖面线失败:', error)
      // 失败用 toast：重新选择剖面/切换水位即自动重试
      showError(error, { fallback: '加载剖面线数据失败' })
    }
  }

  /** 当前选中的剖面数据 */
  function getCurrentProfile(): TerrainProfile | undefined {
    return profiles.value.find((p) => p.id === selectedProfileId.value)
  }

  return { profiles, selectedProfileId, loadProfiles, getCurrentProfile }
}
