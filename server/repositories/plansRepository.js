// 依赖文件在 server/data/ 中的相对位置，勿移动此文件
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

// 内存缓存：避免每次读操作都访问磁盘，解决并发读写不一致问题
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
const DATA_FILE = path.join(__dirname, '../data/plans.json')

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
async function writeAll(plans) {
  await fs.writeFile(DATA_FILE, JSON.stringify(plans, null, 2), 'utf-8')
  // 写入后立即更新缓存，保证后续读操作拿到最新数据
  cache = plans
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
      savedXiaoqu: [], // 已保存的小区列表
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    plans.push(newPlan)
    await writeAll(plans)
    return newPlan
  })
}

// P0-003-FIX: 安全的字段白名单，防止原型链污染
const PLAN_UPDATE_FIELDS = ['name', 'selectedKeys', 'typeSettings', 'weights', 'savedXiaoqu']

export async function update(id, updates) {
  return sequential(async () => {
    const plans = await readAll()
    const index = plans.findIndex((p) => p.id === id)
    if (index === -1) return null

    // P0-003-FIX: 只允许白名单字段更新，防止 __proto__/constructor 污染
    const safeUpdates = {}
    for (const key of PLAN_UPDATE_FIELDS) {
      if (key in updates) safeUpdates[key] = updates[key]
    }

    const updated = { ...plans[index], ...safeUpdates, id: plans[index].id, createdAt: plans[index].createdAt, updatedAt: new Date().toISOString() }
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

/**
 * 保存小区到方案
 * @param {string} planId - 方案ID
 * @param {object} xiaoqu - 小区详情（包含 id, name, score, breakdown, selectionCriteria 等）
 */
export async function saveXiaoqu(planId, xiaoqu) {
  return sequential(async () => {
    const plans = await readAll()
    const plan = plans.find((p) => p.id === planId)
    if (!plan) return null

    // 初始化 savedXiaoqu 数组（兼容旧数据）
    if (!plan.savedXiaoqu) plan.savedXiaoqu = []

    // 检查是否已存在
    const exists = plan.savedXiaoqu.some((xq) => xq.id === xiaoqu.id)
    if (exists) {
      // 更新已存在的小区
      plan.savedXiaoqu = plan.savedXiaoqu.map((xq) =>
        xq.id === xiaoqu.id ? { ...xiaoqu, savedAt: new Date().toISOString() } : xq
      )
    } else {
      // 添加新小区
      plan.savedXiaoqu.push({ ...xiaoqu, savedAt: new Date().toISOString() })
    }

    plan.updatedAt = new Date().toISOString()
    await writeAll(plans)
    return plan
  })
}

/**
 * 从方案中移除小区
 * @param {string} planId - 方案ID
 * @param {string} xiaoquId - 小区ID
 */
export async function removeXiaoqu(planId, xiaoquId) {
  return sequential(async () => {
    const plans = await readAll()
    const plan = plans.find((p) => p.id === planId)
    if (!plan) return null

    if (!plan.savedXiaoqu) plan.savedXiaoqu = []

    const beforeLength = plan.savedXiaoqu.length
    plan.savedXiaoqu = plan.savedXiaoqu.filter((xq) => xq.id !== xiaoquId)

    if (plan.savedXiaoqu.length === beforeLength) {
      // 没有找到要移除的小区
      return plan
    }

    plan.updatedAt = new Date().toISOString()
    await writeAll(plans)
    return plan
  })
}
