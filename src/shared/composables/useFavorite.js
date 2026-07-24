/**
 * useFavorite — 收藏功能快捷入口
 *
 * 使用方式：
 *   const { isFav, toggleFav } = useFavorite()
 *   toggleFav({ type: 'page', title: '选址分析', route: '/site-selection' })
 *   // 收藏到默认收藏夹，点击后可在抽屉中移动到私人夹
 */

import { useFavoriteStore } from '@/stores/favoriteStore'
import { useRoute } from 'vue-router'

export function useFavorite() {
  const store = useFavoriteStore()
  const route = useRoute()

  function favoriteCurrentPage(title) {
    store.add({
      type: 'page',
      title: title || route.meta?.title || route.name || '未命名页面',
      description: '',
      route: route.path,
      params: { ...route.query },
    })
  }

  function toggleCurrentPage(title) {
    const t = title || route.meta?.title || route.name || '未命名页面'
    if (store.isFavorited('page', t)) {
      store.remove(store.allItems().find(i => i.type === 'page' && i.title === t)?.id)
      return false
    }
    store.add({ type: 'page', title: t, description: '', route: route.path })
    return true
  }

  function isCurrentPageFavorited(title) {
    return store.isFavorited('page', title || route.meta?.title || route.name || '')
  }

  return { favoriteStore: store, favoriteCurrentPage, toggleCurrentPage, isCurrentPageFavorited }
}
