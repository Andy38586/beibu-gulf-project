/**
 * 通用收藏夹 Store
 *
 * v1.5 冻结版本：独立通用模块，localStorage 持久化
 * 支持收藏：页面路由、分析方案、常用位置
 *
 * 不修改核心架构，不依赖其他 Store。
 */

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_KEY = 'beibu-gulf-favorites'

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveToStorage(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch (e) {
    console.warn('[FavoriteStore] localStorage 写入失败:', e)
  }
}

export const useFavoriteStore = defineStore('favorite', () => {
  const items = ref(loadFromStorage())

  // 自动持久化
  watch(items, (val) => saveToStorage(val), { deep: true })

  /**
   * 添加收藏
   * @param {{ type: string, title: string, description?: string, route?: string, params?: object }} item
   */
  function add(item) {
    if (!item.type || !item.title) {
      console.warn('[FavoriteStore] 收藏项缺少 type/title')
      return
    }
    // 去重：同类型 + 同标题
    const exists = items.value.find(i => i.type === item.type && i.title === item.title)
    if (exists) return

    items.value.push({
      id: `${item.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: item.title,
      type: item.type,
      description: item.description || '',
      route: item.route || '',
      params: item.params || {},
      createdAt: Date.now(),
    })
  }

  /**
   * 移除收藏
   * @param {string} id
   */
  function remove(id) {
    const idx = items.value.findIndex(i => i.id === id)
    if (idx >= 0) items.value.splice(idx, 1)
  }

  /**
   * 检查是否已收藏
   * @param {string} type
   * @param {string} title
   * @returns {boolean}
   */
  function isFavorited(type, title) {
    return items.value.some(i => i.type === type && i.title === title)
  }

  /**
   * 切换收藏状态
   */
  function toggle(item) {
    if (isFavorited(item.type, item.title)) {
      const found = items.value.find(i => i.type === item.type && i.title === item.title)
      if (found) remove(found.id)
    } else {
      add(item)
    }
  }

  /**
   * 获取指定类型的收藏列表
   * @param {string} type
   */
  function getByType(type) {
    return items.value.filter(i => i.type === type)
  }

  function clear() {
    items.value = []
    saveToStorage([])
  }

  return { items, add, remove, isFavorited, toggle, getByType, clear }
})
