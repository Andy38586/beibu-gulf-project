/**
 * useFavorites - 全局收藏状态单例（module 级，与 useAuth/useTheme 同模式）
 * 唯一事实源：后端 /api/favorites（用户数据，登录态绑定）；同用户下 itemType + itemId 全局唯一。
 * 登录后自动拉取；登出清空；未登录期的收藏意图（pendingFavorite）在登录成功后自动补完——
 * 用户点收藏 → 登录 → 无需再点一次。
 */
import type { ComputedRef, Ref } from 'vue'
import { computed, ref, watch } from 'vue'

import { ENDPOINTS } from '@/shared/constants/api'
import type { FavoriteAddInput, FavoriteItem, FavoriteItemType } from '@/types'
import {
  favoriteAddResponseSchema,
  favoriteRemoveResponseSchema,
  favoritesArraySchema,
} from '@/types/schemas'

import { showError } from '../utils/errorHandler'
import { showToast } from '../utils/gcsFeedback'

import { useApiRequest } from './useApiRequest'
import { useAuth } from './useAuth'

const favorites = ref<FavoriteItem[]>([])
let fetchInFlight = false
/** 未登录时的收藏意图：登录成功后自动补完 */
let pendingFavorite: FavoriteAddInput | null = null

const { apiRequest } = useApiRequest()
const { user } = useAuth()

/** 返回契约（对齐 816-专项3-0816-13：显式化，防签名静默漂移） */
export interface UseFavoritesReturn {
  favorites: Readonly<Ref<FavoriteItem[]>>
  isLoggedIn: ComputedRef<boolean>
  isFavorite: (itemType: FavoriteItemType, itemId: string) => boolean
  addFavorite: (input: FavoriteAddInput) => Promise<{ existed: boolean }>
  removeFavorite: (itemType: FavoriteItemType, itemId: string) => Promise<boolean>
  queuePendingFavorite: (input: FavoriteAddInput) => void
}

async function fetchFavorites(): Promise<void> {
  const items = await apiRequest<FavoriteItem[]>(ENDPOINTS.favorites.root, {
    schema: favoritesArraySchema,
  })
  favorites.value = items
}

/** 登录态驱动：登录 → 拉取 + 补完未登录期的收藏意图；登出 → 清空 */
watch(
  user,
  async (u) => {
    if (!u) {
      favorites.value = []
      return
    }
    if (fetchInFlight) return
    fetchInFlight = true
    try {
      await fetchFavorites()
    } catch (error) {
      // 拉取失败静默：收藏列表为空，后续 add/remove 仍可用（后端幂等兜底）
      if (import.meta.env.DEV) console.debug('[useFavorites] 拉取收藏失败:', error)
    } finally {
      fetchInFlight = false
    }
    if (pendingFavorite) {
      const input = pendingFavorite
      pendingFavorite = null
      try {
        const { existed } = await commitFavorite(input)
        showToast(existed ? '已在收藏中' : `已收藏：${input.name}`, 'success')
      } catch (error) {
        pendingFavorite = input
        // 走 showError 区分真实成因（服务器无响应 ≠ 笼统失败），与收藏面板同口径
        showError(error, { fallback: '收藏失败，请稍后重试' })
      }
    }
  },
  { immediate: true }
)

async function commitFavorite(input: FavoriteAddInput): Promise<{ existed: boolean }> {
  const res = await apiRequest<{ favorite: FavoriteItem; existed: boolean }>(
    ENDPOINTS.favorites.root,
    {
      method: 'POST',
      body: JSON.stringify(input),
      schema: favoriteAddResponseSchema,
    }
  )
  // 本地态同步：已存在不重复插入（幂等）
  if (!favorites.value.some((f) => f.itemType === input.itemType && f.itemId === input.itemId)) {
    favorites.value = [res.favorite, ...favorites.value]
  }
  return { existed: res.existed }
}

export function useFavorites(): UseFavoritesReturn {
  const isLoggedIn = computed(() => user.value !== null)

  function isFavorite(itemType: FavoriteItemType, itemId: string): boolean {
    return favorites.value.some((f) => f.itemType === itemType && f.itemId === itemId)
  }

  async function addFavorite(input: FavoriteAddInput): Promise<{ existed: boolean }> {
    if (!user.value) {
      throw new Error('请先登录')
    }
    return commitFavorite(input)
  }

  async function removeFavorite(itemType: FavoriteItemType, itemId: string): Promise<boolean> {
    if (!user.value) {
      throw new Error('请先登录')
    }
    const res = await apiRequest<{ removed: boolean }>(ENDPOINTS.favorites.item(itemType, itemId), {
      method: 'DELETE',
      schema: favoriteRemoveResponseSchema,
    })
    if (res.removed) {
      favorites.value = favorites.value.filter(
        (f) => !(f.itemType === itemType && f.itemId === itemId)
      )
    }
    return res.removed
  }

  function queuePendingFavorite(input: FavoriteAddInput): void {
    pendingFavorite = input
  }

  return { favorites, isLoggedIn, isFavorite, addFavorite, removeFavorite, queuePendingFavorite }
}
