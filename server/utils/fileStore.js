// BUGFIX-R-01: 文件存储工厂，统一缓存/写锁基础设施（markers/plans/users 共用）
import fs from 'fs/promises'

export function createFileStore(filePath, { useCache = true } = {}) {
  let cache = null
  let writeLock = Promise.resolve()

  function sequential(fn) {
    const next = writeLock.then(fn, fn)
    writeLock = next.then(() => {}, () => {})
    return next
  }

  async function readAll() {
    if (useCache && cache !== null) return cache
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const data = JSON.parse(content)
      if (useCache) cache = data
      return data
    } catch (error) {
      if (error.code === 'ENOENT') {
        if (useCache) cache = []
        return []
      }
      throw error
    }
  }

  async function writeAll(data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
    if (useCache) cache = data
  }

  return { sequential, readAll, writeAll }
}
