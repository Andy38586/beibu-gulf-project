// 依赖文件在 backend/data/ 中的相对位置，勿移动此文件
import crypto from 'crypto'
import path from 'path'
import { fileURLToPath } from 'url'

import { createFileStore } from '../utils/fileStore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_FILE = path.join(__dirname, '../data/favorites.json')

// 复用 createFileStore 工厂（读缓存 + 写锁 + 原子写入），与 plans/users 同基础设施
const { sequential, readAll, writeAll } = createFileStore(DATA_FILE)

// 全局唯一键：同一用户下 (itemType, itemId) 唯一——收藏过一次即存在，跨页面/跨业务不再重复
export async function findAllByUserId(userId) {
  const favorites = await readAll()
  return favorites
    .filter((f) => f.userId === userId)
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1)) // 最新在前
}

export async function findByKey(userId, itemType, itemId) {
  const favorites = await readAll()
  return (
    favorites.find(
      (f) => f.userId === userId && f.itemType === itemType && f.itemId === itemId
    ) || null
  )
}

/**
 * 添加收藏（幂等）：同键已存在时直接返回既有项（existed: true），不重复写入——
 * 收藏过一次就不能再收藏的全局语义由本函数保证
 */
export async function add(userId, item) {
  return sequential(async () => {
    const favorites = await readAll()
    const existing = favorites.find(
      (f) => f.userId === userId && f.itemType === item.itemType && f.itemId === item.itemId
    )
    if (existing) {
      return { favorite: existing, existed: true }
    }
    const newFavorite = {
      id: crypto.randomUUID(),
      userId,
      ...item,
      savedAt: new Date().toISOString(),
    }
    favorites.push(newFavorite)
    await writeAll(favorites)
    return { favorite: newFavorite, existed: false }
  })
}

export async function remove(userId, itemType, itemId) {
  return sequential(async () => {
    const favorites = await readAll()
    const next = favorites.filter(
      (f) => !(f.userId === userId && f.itemType === itemType && f.itemId === itemId)
    )
    if (next.length === favorites.length) {
      return false
    }
    await writeAll(next)
    return true
  })
}
