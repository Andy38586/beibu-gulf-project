// 依赖文件在 backend/data/ 中的相对位置，勿移动此文件
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

import { createReadCache } from '../utils/createReadCache.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const FILE = 'ports.json'
// 统一只读缓存（createReadCache：TTL + LRU 上限,数据流收口②）
const cache = createReadCache({ maxSize: 20 })

async function readJsonFile(filename) {
  const cached = cache.get(filename)
  if (cached !== undefined) return cached
  const filePath = path.join(__dirname, '../data', filename)
  const content = await fs.readFile(filePath, 'utf-8')
  const data = JSON.parse(content)
  cache.set(filename, data)
  return data
}

// 港口为地图参考要素，与行政区划/边界同源，属公开只读数据
export async function findAll() {
  return readJsonFile(FILE)
}
