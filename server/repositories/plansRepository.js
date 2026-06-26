// 依赖文件在 server/data/ 中的相对位置，勿移动此文件
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

let writeLock = Promise.resolve()
function sequential(fn) {
  return (writeLock = writeLock.then(fn))
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_FILE = path.join(__dirname, '../data/plans.json')

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
async function writeAll(plans) {
  await fs.writeFile(DATA_FILE, JSON.stringify(plans, null, 2), 'utf-8')
}

export async function findAllByUserId(userId) {
  const plans = await readAll()
  return plans.filter((p) => p.userId === userId)
}

export async function findById(id) {
  const plans = await readAll()
  return plans.find((p) => p.id === id) || null
}

export async function create(planData) {
  return sequential(async () => {
    const plans = await readAll()
    const newPlan = {
      id: Date.now().toString(),
      ...planData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    plans.push(newPlan)
    await writeAll(plans)
    return newPlan
  })
}

export async function update(id, updates) {
  return sequential(async () => {
    const plans = await readAll()
    const index = plans.findIndex((p) => p.id === id)
    if (index === -1) return null

    const updated = { ...plans[index], ...updates, id: plans[index].id, createdAt: plans[index].createdAt, updatedAt: new Date().toISOString() }
    plans[index] = updated
    await writeAll(plans)
    return updated
  })
}

export async function remove(id) {
  return sequential(async () => {
    const plans = await readAll()
    const filtered = plans.filter((p) => p.id !== id)
    if (filtered.length === plans.length) return false
    await writeAll(filtered)
    return true
  })
}
