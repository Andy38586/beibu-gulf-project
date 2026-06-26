import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

let writeLock = Promise.resolve()
function sequential(fn) {
  return (writeLock = writeLock.then(fn))
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_FILE = path.join(__dirname, '../data/markers.json')

async function readAll() {
  try {
    const content = await fs.readFile(DATA_FILE, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}
async function writeAll(markers) {
  await fs.writeFile(DATA_FILE, JSON.stringify(markers, null, 2), 'utf-8')
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
export async function update(id, updates) {
  return sequential(async () => {
  const markers = await readAll()
  const index = markers.findIndex((m) => m.id === id)
  if (index === -1) return null

  markers[index] = { ...markers[index], ...updates, updatedAt: new Date().toISOString() }
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
