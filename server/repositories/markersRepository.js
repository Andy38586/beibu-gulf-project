// 依赖文件在 server/data/ 中的相对位置，勿移动此文件
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

// P0-002-FIX: 添加内存缓存，与 plansRepository 保持一致，解决并发读写不一致问题
let cache = null
let writeLock = Promise.resolve()
function sequential(fn) {
  const next = writeLock.then(fn, fn)
  writeLock = next.then(
    () => {},
    () => {},
  )
  return next
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_FILE = path.join(__dirname, '../data/markers.json')

async function readAll() {
  // 优先使用内存缓存，避免并发读文件导致数据不一致
  if (cache !== null) return cache
  try {
    const content = await fs.readFile(DATA_FILE, 'utf-8')
    cache = JSON.parse(content)
    return cache
  } catch (error) {
    if (error.code === 'ENOENT') {
      cache = []
      return cache
    }
    throw error
  }
}
async function writeAll(markers) {
  await fs.writeFile(DATA_FILE, JSON.stringify(markers, null, 2), 'utf-8')
  // 写入后立即更新缓存，保证后续读操作拿到最新数据
  cache = markers
}
export async function findAll() {
  return readAll()
}
export async function findById(id) {
  const markers = await readAll()
  return markers.find((m) => m.id === id)
}
export async function create(markerData) {
  return sequential(async () => {
  const markers = await readAll()
  const newMarker = {
    id: Date.now().toString(),
    ...markerData,
    createdAt: new Date().toISOString(),
  }
  markers.push(newMarker)
  await writeAll(markers)
  return newMarker
  })
}
// P0-003-FIX: 安全的字段白名单，防止原型链污染
const MARKER_UPDATE_FIELDS = ['name', 'lng', 'lat', 'type', 'description', 'userId']

export async function update(id, updates) {
  return sequential(async () => {
  const markers = await readAll()
  const index = markers.findIndex((m) => m.id === id)
  if (index === -1) return null

  // P0-003-FIX: 只允许白名单字段更新，防止 __proto__/constructor 污染
  const safeUpdates = {}
  for (const key of MARKER_UPDATE_FIELDS) {
    if (key in updates) safeUpdates[key] = updates[key]
  }

  markers[index] = { ...markers[index], ...safeUpdates, updatedAt: new Date().toISOString() }
  await writeAll(markers)
  return markers[index]
  })
}
export async function remove(id) {
  return sequential(async () => {
  const markers = await readAll()
  const filtered = markers.filter((m) => m.id !== id)
  if (filtered.length === markers.length) return false
  await writeAll(filtered)
  return true
  })
}
