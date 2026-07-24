import path from 'path'
import { fileURLToPath } from 'url'
import { createFileStore } from '../utils/fileStore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_FILE = path.join(__dirname, '../data/users.json')

// FIX:R-01: 复用 createFileStore 工厂（users 无缓存，useCache: false）
const { sequential, readAll, writeAll } = createFileStore(DATA_FILE, { useCache: false })

export async function findByUsername(username) {
  const users = await readAll()
  return users.find((u) => u.username === username) || null
}

export async function createUser(username, hashedPassword) {
  return sequential(async () => {
    const users = await readAll()
    // FIX:P1-06: 锁内查重，消除 TOCTOU 竞态
    if (users.some((u) => u.username === username)) {
      const err = new Error('用户名已存在')
      err.code = 'DUPLICATE_USERNAME'
      throw err
    }
    // FIX:SEC-012: 使用 crypto.randomUUID() 生成不可预测的用户ID
    const newUser = {
      id: crypto.randomUUID(),
      username,
      password: hashedPassword,
      createdAt: new Date().toISOString(),
    }
    users.push(newUser)
    await writeAll(users)
    return { id: newUser.id, username: newUser.username, createdAt: newUser.createdAt }
  })
}

export async function userExists(username) {
  const user = await findByUsername(username)
  return user !== null
}

// FIX:P1-14: 支持登录成功后静默迁移密码哈希
export async function updatePassword(userId, hashedPassword) {
  return sequential(async () => {
    const users = await readAll()
    const target = users.find((u) => u.id === userId)
    if (!target) return false
    target.password = hashedPassword
    await writeAll(users)
    return true
  })
}
