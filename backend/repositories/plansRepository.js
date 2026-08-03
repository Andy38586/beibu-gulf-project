// 依赖文件在 backend/data/ 中的相对位置，勿移动此文件
import path from 'path'
import { fileURLToPath } from 'url'
import { createFileStore } from '../utils/fileStore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_FILE = path.join(__dirname, '../data/plans.json')

// 复用 createFileStore 工厂，消除与 userService 的重复基础设施
const { sequential, readAll, writeAll } = createFileStore(DATA_FILE)

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
      // UUID 防并发碰撞，与 userService 对齐
      id: crypto.randomUUID(),
      ...planData,
      savedXiaoqu: [], // 已保存的小区列表
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    // 不原地修改缓存数组，构造新数组，写盘失败时缓存不脏
    const next = [...plans, newPlan]
    await writeAll(next)
    return newPlan
  })
}

// 安全的字段白名单，防止原型链污染
// 白名单补 flood 系字段，浸没方案才能被更新保存
const PLAN_UPDATE_FIELDS = [
  'name',
  'selectedKeys',
  'typeSettings',
  'weights',
  'savedXiaoqu',
  'businessType',
  'waterLevel',
  'floodStatistics',
  'floodFeatures',
  'floodRiskLevel',
  'affectedFacilities',
  'totalLoss',
]

export async function update(id, updates) {
  return sequential(async () => {
    const plans = await readAll()
    const index = plans.findIndex((p) => p.id === id)
    if (index === -1) return null

    // 只允许白名单字段更新，防止 __proto__/constructor 污染
    const safeUpdates = {}
    for (const key of PLAN_UPDATE_FIELDS) {
      if (key in updates) safeUpdates[key] = updates[key]
    }

    const updated = {
      ...plans[index],
      ...safeUpdates,
      id: plans[index].id,
      createdAt: plans[index].createdAt,
      updatedAt: new Date().toISOString(),
    }
    // 不原地修改缓存数组，构造新数组，写盘失败时缓存不脏
    const next = plans.map((p, i) => (i === index ? updated : p))
    await writeAll(next)
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

    const existing = plan.savedXiaoqu || []
    let newSavedXiaoqu
    if (existing.some((xq) => xq.id === xiaoqu.id)) {
      // 更新已存在的小区
      newSavedXiaoqu = existing.map((xq) =>
        xq.id === xiaoqu.id ? { ...xiaoqu, savedAt: new Date().toISOString() } : xq
      )
    } else {
      // 添加新小区
      newSavedXiaoqu = [...existing, { ...xiaoqu, savedAt: new Date().toISOString() }]
    }

    // 构造新 plan + 新 plans 数组，杜绝原地修改
    const updatedPlan = {
      ...plan,
      savedXiaoqu: newSavedXiaoqu,
      updatedAt: new Date().toISOString(),
    }
    const next = plans.map((p) => (p.id === planId ? updatedPlan : p))
    await writeAll(next)
    return updatedPlan
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

    const existing = plan.savedXiaoqu || []
    const newSavedXiaoqu = existing.filter((xq) => xq.id !== xiaoquId)

    if (newSavedXiaoqu.length === existing.length) {
      // 没有找到要移除的小区
      return plan
    }

    // 构造新 plan + 新 plans 数组，杜绝原地修改
    const updatedPlan = {
      ...plan,
      savedXiaoqu: newSavedXiaoqu,
      updatedAt: new Date().toISOString(),
    }
    const next = plans.map((p) => (p.id === planId ? updatedPlan : p))
    await writeAll(next)
    return updatedPlan
  })
}
