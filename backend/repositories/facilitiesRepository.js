// 依赖文件在 backend/data/ 中的相对位置，勿移动此文件
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

import { createReadCache } from '../utils/createReadCache.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const FILE_MAP = {
  hospital: 'site-selection/qz_hospital.json',
  primary_school: 'site-selection/qz_primary_school.json',
  middle_school: 'site-selection/qz_middle_school.json',
  park: 'site-selection/qz_park.json',
  bus_station: 'site-selection/qz_bus_station.json',
  mall: 'site-selection/qz_mall_and_supermarket.json',
  xiaoqu: 'site-selection/xiaoqu.json',
}

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
