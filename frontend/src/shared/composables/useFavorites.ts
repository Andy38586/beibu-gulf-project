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
import { isAuthRestoreDone, useAuth } from './useAuth'

const favorites = ref<FavoriteItem[]>([])
let fetchInFlight = false
/** 在途期间又有登录态变化：置脏，本次结束后补拉一次（在途置脏重放） */
let fetchDirty = false
/** 未登录时的收藏意图：登录成功后自动补完 */
let pendingFavorite: FavoriteAddInput | null = null

const { apiRequest } = useApiRequest()
const { user, token } = useAuth()

/** 返回契约（对齐 显式化，防签名静默漂移） */
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

/** 拉取收藏（含在途合并与错误分级）：在途时置脏不丢事件，结束后补拉一次 */
async function loadFavorites(): Promise<void> {
  if (fetchInFlight) {
    fetchDirty = true
    return
  }
  fetchInFlight = true
  try {
    await fetchFavorites()
  } catch (error) {
    if (!isAuthRestoreDone()) {
      // 恢复期（/auth/me 未完成）：stale localStorage user 的 401 可能随后被 restore
      // 清场，此刻提示多为误报 → 静默；恢复成功路径 user 会重新赋值，本 watch 自动重拉
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console -- DEV 门控诊断（logger.debug 级别语义不同）
        console.debug('[useFavorites] 恢复期拉取收藏失败（静默，待恢复后重判）:', error)
      }
    } else {
      // 恢复完成后仍失败：显式可见（原实现一律静默 → 收藏面板空白且无解释，审查 L-3）
      showError(error, { fallback: '收藏列表加载失败，请稍后重试' })
    }
  } finally {
    fetchInFlight = false
    if (fetchDirty) {
      fetchDirty = false
      void loadFavorites()
    }
  }
}

/** 登录态驱动：登录 → 拉取 + 补完未登录期的收藏意图；登出 → 清空。
 *  源含 token：restore 以「保留临时登录态」收场时（后端不可达 ≠ 未登录）user 不变，
 *  仅 token 置位 —— 监听 token 空→非空让该路径也能触发重拉（恢复期分级） */
watch(
  [user, token],
  async ([u]) => {
    if (!u) {
      favorites.value = []
      return
    }
    await loadFavorites()
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
