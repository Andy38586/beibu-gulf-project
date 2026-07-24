/**
 * useFavorite — 收藏功能快捷入口
 *
 * 使用方式（在任何页面中）：
 *   const { isFav, toggleFav } = useFavorite()
 *   toggleFav({ type: 'page', title: '选址分析', route: '/site-selection' })
 */

import { useFavoriteStore } from '@/stores/favoriteStore'
import { useRoute } from 'vue-router'

export function useFavorite() {
  const favoriteStore = useFavoriteStore()
  const route = useRoute()

  /**
   * 收藏当前页面
   */
  function favoriteCurrentPage(title) {
    favoriteStore.add({
      type: 'page',
      title: title || route.meta?.title || route.name || '未命名页面',
      description: '',
      route: route.path,
      params: { ...route.query },
    })
  }

  /**
   * 切换当前页面收藏状态
   * @param {string} [title] - 显示标题，默认取 route.meta.title
   * @returns {boolean} - 收藏后为 true，取消后为 false
   */
  function toggleCurrentPage(title) {
    const t = title || route.meta?.title || route.name || '未命名页面'
    const exists = favoriteStore.isFavorited('page', t)
    if (exists) {
      const found = favoriteStore.items.find(i => i.type === 'page' && i.title === t)
      if (found) favoriteStore.remove(found.id)
      return false
    }
    favoriteCurrentPage(t)
    return true
  }

  /**
   * 当前页面是否已收藏
   */
  function isCurrentPageFavorited(title) {
    const t = title || route.meta?.title || route.name || '未命名页面'
    return favoriteStore.isFavorited('page', t)
  }

  return {
    favoriteStore,
    favoriteCurrentPage,
    toggleCurrentPage,
    isCurrentPageFavorited,
  }
}
