// readStaticJson — 读 backend/data 静态 JSON 的统一入口（createReadCache 读文件缓存工厂，TTL + LRU）；
// 静态只读数据在此直读，repository 层只保留有真实职责的 plans（CRUD + 用户归属校验）
import { readFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

import { createReadCache } from './createReadCache.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 统一只读缓存：文件路径 → 解析后的 JSON
const cache = createReadCache({ maxSize: 20 })

/**
 * 读取 backend/data/ 下的 JSON 文件（带 TTL + LRU 缓存）。
 * @param {string} filename 相对 backend/data/ 的文件名（如 'ports.json'）
 * @returns {Promise<unknown>} 解析后的 JSON 数据
 */
export async function readStaticJson(filename) {
  const cached = cache.get(filename)
  if (cached !== undefined) return cached
  const filePath = path.join(__dirname, '../data', filename)
  const content = await readFile(filePath, 'utf-8')
  const data = JSON.parse(content)
  cache.set(filename, data)
  return data
}

// 测试钩子：用例可直接操纵缓存
export const _cache = cache

/** 测试用：清空统一只读缓存，避免跨用例污染 */
export function _clearCacheForTest() {
  cache.clear()
}
