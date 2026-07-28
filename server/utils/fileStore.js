// @arch-note R-01: 文件存储工厂，统一缓存/写锁基础设施（markers/plans/users 共用）
import fs from 'fs/promises'

export function createFileStore(filePath, { useCache = true } = {}) {
  let cache = null
  let writeLock = Promise.resolve()

  function sequential(fn) {
    const next = writeLock.then(fn, fn)
    writeLock = next.then(
      () => {},
      () => {}
    )
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
    // 原子写入：先写临时文件，再 rename
    const tmpPath = `${filePath}.tmp`
    const content = JSON.stringify(data, null, 2)

    try {
      await fs.writeFile(tmpPath, content, 'utf-8')
      await fs.rename(tmpPath, filePath)
      if (useCache) cache = data
    } catch (error) {
      // 清理临时文件
      try {
        await fs.unlink(tmpPath)
      } catch {
        // 忽略清理错误
      }
      throw error
    }
  }

  return { sequential, readAll, writeAll }
}
