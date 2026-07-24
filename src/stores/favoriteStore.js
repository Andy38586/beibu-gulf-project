/**
 * 收藏夹 Store — 文件夹结构
 *
 * v1.5：抽屉式面板，默认收藏夹 + 可新增私人文件夹
 * localStorage 持久化，不依赖其他 Store。
 *
 * 结构：
 * folders: [
 *   { id: 'default', name: '默认收藏夹', items: [...], expanded: true },
 *   { id: 'xxx', name: '私人收藏夹', items: [...], expanded: false },
 * ]
 */

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_KEY = 'beibu-gulf-fav-folders'
const DEFAULT_FOLDER = { id: 'default', name: '默认收藏夹', items: [], expanded: true }

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [structuredClone(DEFAULT_FOLDER)]
    const data = JSON.parse(raw)
    if (!Array.isArray(data) || data.length === 0) return [structuredClone(DEFAULT_FOLDER)]
    // 确保默认文件夹存在
    if (!data.find(f => f.id === 'default')) data.unshift(structuredClone(DEFAULT_FOLDER))
    return data
  } catch {
    return [structuredClone(DEFAULT_FOLDER)]
  }
}

function save(folders) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(folders)) }
  catch (e) { console.warn('[FavoriteStore] 写入失败:', e) }
}

function uid() {
  return `fav-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export const useFavoriteStore = defineStore('favorite', () => {
  const folders = ref(load())
  watch(folders, (v) => save(v), { deep: true })

  // ============ 文件夹操作 ============

  /** 新增私人收藏夹 */
  function addFolder(name) {
    if (!name || !name.trim()) return
    const trimmed = name.trim()
    if (folders.value.find(f => f.name === trimmed)) return // 重名跳过
    folders.value.push({ id: uid(), name: trimmed, items: [], expanded: false })
  }

  /** 删除收藏夹（默认夹不能删） */
  function removeFolder(id) {
    if (id === 'default') return
    const idx = folders.value.findIndex(f => f.id === id)
    if (idx >= 0) folders.value.splice(idx, 1)
  }

  /** 切换展开/折叠 */
  function toggleFolder(id) {
    const f = folders.value.find(f => f.id === id)
    if (f) f.expanded = !f.expanded
  }

  // ============ 收藏项操作 ============

  function findFolder(id) {
    return folders.value.find(f => f.id === id)
  }

  /** 添加收藏到指定文件夹（默认到默认夹） */
  function addToFolder(item, folderId = 'default') {
    if (!item.type || !item.title) return
    const folder = findFolder(folderId)
    if (!folder) return
    // 全局去重
    const exists = folders.value.some(f => f.items.some(i => i.type === item.type && i.title === item.title))
    if (exists) return
    folder.items.push({
      id: uid(),
      type: item.type,
      title: item.title,
      description: item.description || '',
      route: item.route || '',
      params: item.params || {},
      createdAt: Date.now(),
    })
  }

  /** 从指定文件夹移除 */
  function removeFromFolder(itemId, folderId) {
    const folder = findFolder(folderId)
    if (!folder) return
    const idx = folder.items.findIndex(i => i.id === itemId)
    if (idx >= 0) folder.items.splice(idx, 1)
  }

  /** 在文件夹间移动 */
  function moveItem(itemId, fromFolderId, toFolderId) {
    const from = findFolder(fromFolderId)
    const to = findFolder(toFolderId)
    if (!from || !to) return
    const idx = from.items.findIndex(i => i.id === itemId)
    if (idx < 0) return
    const [item] = from.items.splice(idx, 1)
    // 目标文件夹去重
    if (!to.items.find(i => i.type === item.type && i.title === item.title)) {
      to.items.push(item)
    }
  }

  // ============ 兼容旧 API ============

  /** 添加（默认到默认收藏夹） */
  function add(item) { addToFolder(item, 'default') }

  /** 全局移除 */
  function remove(id) {
    for (const f of folders.value) {
      const idx = f.items.findIndex(i => i.id === id)
      if (idx >= 0) { f.items.splice(idx, 1); return }
    }
  }

  /** 全局检查是否已收藏 */
  function isFavorited(type, title) {
    return folders.value.some(f => f.items.some(i => i.type === type && i.title === title))
  }

  /** 切换收藏（默认进入默认夹） */
  function toggle(item) {
    if (isFavorited(item.type, item.title)) {
      for (const f of folders.value) {
        const idx = f.items.findIndex(i => i.type === item.type && i.title === item.title)
        if (idx >= 0) { f.items.splice(idx, 1); return }
      }
    } else {
      addToFolder(item, 'default')
    }
  }

  /** 获取所有收藏项（扁平） */
  function allItems() {
    const result = []
    for (const f of folders.value) result.push(...f.items)
    return result
  }

  function clear() {
    folders.value = [structuredClone(DEFAULT_FOLDER)]
    save(folders.value)
  }

  return {
    folders,
    addFolder, removeFolder, toggleFolder,
    addToFolder, removeFromFolder, moveItem,
    add, remove, isFavorited, toggle,
    allItems, clear,
  }
})
