import path from 'path'
import { fileURLToPath } from 'url'
import { createFileStore } from '../utils/fileStore.js'
import { BusinessError, ErrorCode } from '../utils/BusinessError.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_FILE = path.join(__dirname, '../data/users.json')

// d045: 启用缓存，消除认证层每次请求读盘（writeAll 自动同步 cache，单进程安全）
const { sequential, readAll, writeAll } = createFileStore(DATA_FILE, { useCache: true })

export async function findByUsername(username) {
  const users = await readAll()
  return users.find((u) => u.username === username) || null
}

export async function createUser(username, hashedPassword) {
  return sequential(async () => {
    const users = await readAll()
    // @arch-note P1-06: 锁内查重，消除 TOCTOU 竞态
    if (users.some((u) => u.username === username)) {
      throw new BusinessError(ErrorCode.DUPLICATE_USERNAME)
    }
    // @arch-note SEC-012: 使用 crypto.randomUUID() 生成不可预测的用户ID
    const newUser = {
      id: crypto.randomUUID(),
      username,
      password: hashedPassword,
      createdAt: new Date().toISOString(),
      tokenVersion: 0,
    }
    users.push(newUser)
    await writeAll(users)
    return {
      id: newUser.id,
      username: newUser.username,
      createdAt: newUser.createdAt,
      tokenVersion: 0,
    }
  })
}

export async function userExists(username) {
  const user = await findByUsername(username)
  return user !== null
}

export async function findById(id) {
  const users = await readAll()
  return users.find((u) => u.id === id) || null
}

// @arch-note SEC-007: 令牌吊销——自增 tokenVersion，使旧 token 在 authenticate 校验时失效
export async function updateTokenVersion(id) {
  return sequential(async () => {
    const users = await readAll()
    const target = users.find((u) => u.id === id)
    if (!target) return false
    target.tokenVersion = (target.tokenVersion ?? 0) + 1
    await writeAll(users)
    return target.tokenVersion
  })
}

// @arch-note P1-14: 支持登录成功后静默迁移密码哈希
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
