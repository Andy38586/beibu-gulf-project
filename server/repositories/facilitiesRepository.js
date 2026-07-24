// 依赖文件在 server/data/ 中的相对位置，勿移动此文件
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const FILE_MAP = {
  hospital: 'qz_hospital.json',
  primary_school: 'qz_primary_school.json',
  middle_school: 'qz_middle_school.json',
  park: 'qz_park.json',
  bus_station: 'qz_bus_station.json',
  mall: 'qz_mall_and_supermarket.json',
  xiaoqu: 'xiaoqu.json',
}

const cache = new Map()
// FIX:P3-09: 缓存加 TTL（5 分钟），过期自动重载
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

export async function findByType(type) {
  const filename = FILE_MAP[type]
  if (!filename) return null
  return readJsonFile(filename)
}
export async function findXiaoqu() {
  return readJsonFile(FILE_MAP.xiaoqu)
}
export function getAvailableTypes() {
  return Object.keys(FILE_MAP).filter((k) => k !== 'xiaoqu')
}
