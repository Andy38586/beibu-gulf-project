import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { Injectable, Optional } from '@nestjs/common'

import { createReadCache } from '../../common/cache/read-cache'

// backend/data 静态只读数据统一入口：对齐老 Express readStaticJson
//（统一 TTL+LRU 读缓存，路径→解析后 JSON；只读数据直读，DB 只留给有真实职责的 repository）
export type ReadFileFn = (filePath: string) => Promise<string>

export const DEFAULT_READ_FILE: ReadFileFn = (filePath) => readFile(filePath, 'utf-8')

// 数据目录解析：优先 DATA_DIR env；否则从 cwd 向上找 backend/data（仓根或 backend/nest
// cwd 都能命中）；一路找不到回落 <cwd>/backend/data（报 ENOENT 而非静默错目录）
export function resolveDataDir(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
  cwd: string = process.cwd()
): string {
  if (env.DATA_DIR) return path.resolve(env.DATA_DIR)
  let dir = cwd
  for (;;) {
    const candidate = path.join(dir, 'backend', 'data')
    if (exists(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(cwd, 'backend/data')
    dir = parent
  }
}

@Injectable()
export class DataFilesService {
  private readonly cache = createReadCache<unknown>({ maxSize: 20 })

  private readonly dataDir: string
  private readonly readFileFn: ReadFileFn

  // readFileFn 注入点：单测以 mock reader 换入（对齐 Express 测试 vi.mock fs/promises 模式）；
  // @Optional 防 Nest DI 把默认参数当依赖解析（函数类型无注入 token）。
  // 普通参数而非参数属性：类字段 readFileFn 已声明，参数属性会报 TS2300 重复标识符
  constructor(@Optional() readFileFn: ReadFileFn = DEFAULT_READ_FILE) {
    this.readFileFn = readFileFn
    this.dataDir = resolveDataDir()
  }

  async read(relPath: string): Promise<unknown> {
    const cached = this.cache.get(relPath)
    if (cached !== undefined) return cached
    const content = await this.readFileFn(path.join(this.dataDir, relPath))
    const data: unknown = JSON.parse(content)
    this.cache.set(relPath, data)
    return data
  }

  /** 测试钩子：清空统一只读缓存，避免跨用例污染（对齐 Express _clearCacheForTest） */
  _clearCacheForTest(): void {
    this.cache.clear()
  }
}
