import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_FILE = path.join(__dirname, '../data/users.json')

let writeLock = Promise.resolve()
function sequential(fn) {
  const next = writeLock.then(fn, fn)
  writeLock = next.then(
    () => {},
    () => {},
  )
  return next
}

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

async function writeAll(users) {
  await fs.writeFile(DATA_FILE, JSON.stringify(users, null, 2), 'utf-8')
}

export async function findByUsername(username) {
  const users = await readAll()
  return users.find((u) => u.username === username) || null
}

export async function createUser(username, hashedPassword) {
  return sequential(async () => {
    const users = await readAll()
    // AUDIT-SEC-012: 使用 crypto.randomUUID() 生成不可预测的用户ID
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
