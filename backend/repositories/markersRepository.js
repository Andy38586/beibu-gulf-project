// 依赖文件在 server/data/ 中的相对位置，勿移动此文件
import path from 'path'
import { fileURLToPath } from 'url'
import { createFileStore } from '../utils/fileStore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_FILE = path.join(__dirname, '../data/markers.json')

// @arch-note R-01: 复用 createFileStore 工厂，消除重复基础设施
const { sequential, readAll, writeAll } = createFileStore(DATA_FILE)
export async function findById(id) {
  const markers = await readAll()
  return markers.find((m) => m.id === id)
}

// @arch-note P0-02: 按归属用户查询
export async function findByUserId(userId) {
  const markers = await readAll()
  return markers.filter((m) => m.userId === userId)
}
export async function create(markerData) {
  return sequential(async () => {
    const markers = await readAll()
    const newMarker = {
      // @arch-note P2-09: UUID 防并发碰撞，与 userService 对齐
      id: crypto.randomUUID(),
      ...markerData,
      createdAt: new Date().toISOString(),
    }
    // @arch-note P2-10: 不原地修改缓存数组，构造新数组，写盘失败时缓存不脏
    const next = [...markers, newMarker]
    await writeAll(next)
    return newMarker
  })
}
// @arch-note P0-02: 白名单移除 userId，禁止篡改归属；description → note 见 @arch-note P1-07
const MARKER_UPDATE_FIELDS = ['name', 'lng', 'lat', 'type', 'note']

export async function update(id, updates) {
  return sequential(async () => {
    const markers = await readAll()
    const index = markers.findIndex((m) => m.id === id)
    if (index === -1) return null

    // @arch-note P0-003: 只允许白名单字段更新，防止 __proto__/constructor 污染
    const safeUpdates = {}
    for (const key of MARKER_UPDATE_FIELDS) {
      if (key in updates) safeUpdates[key] = updates[key]
    }

    const updated = { ...markers[index], ...safeUpdates, updatedAt: new Date().toISOString() }
    // @arch-note P2-10: 不原地修改缓存数组，构造新数组，写盘失败时缓存不脏
    const next = markers.map((m, i) => (i === index ? updated : m))
    await writeAll(next)
    return updated
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
