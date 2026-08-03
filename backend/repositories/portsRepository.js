// 依赖文件在 backend/data/ 中的相对位置，勿移动此文件
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const FILE = 'ports.json'
const cache = new Map()
// 缓存加 TTL（5 分钟），过期自动重载
const CACHE_TTL = 5 * 60 * 1000

async function readJsonFile(filename) {
  const cached = cache.get(filename)
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.data
  }
  const filePath = path.join(__dirname, '../data', filename)
  const content = await fs.readFile(filePath, 'utf-8')
  const data = JSON.parse(content)
  cache.set(filename, { data, cachedAt: Date.now() })
  return data
}

// 港口为地图参考要素，与行政区划/边界同源，属公开只读数据
export async function findAll() {
  return readJsonFile(FILE)
}
