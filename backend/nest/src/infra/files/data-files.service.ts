import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { Injectable, Optional } from '@nestjs/common'

import { createReadCache } from '../../common/cache/read-cache'
import { ConfigService, resolveDataDir } from '../config/config.service'

// backend/data 静态只读数据统一入口：对齐老 Express readStaticJson
//（统一 TTL+LRU 读缓存，路径→解析后 JSON；只读数据直读，DB 只留给有真实职责的 repository）
export type ReadFileFn = (filePath: string) => Promise<string>

export const DEFAULT_READ_FILE: ReadFileFn = (filePath) => readFile(filePath, 'utf-8')

@Injectable()
export class DataFilesService {
  private readonly cache = createReadCache<unknown>({ maxSize: 20 })

  private readonly dataDir: string
  private readonly readFileFn: ReadFileFn

  // readFileFn 注入点：单测以 mock reader 换入（对齐 Express 测试 vi.mock fs/promises 模式）；
  // @Optional 防 Nest DI 把默认参数当依赖解析（函数类型无注入 token）。
  // 普通参数而非参数属性：类字段 readFileFn 已声明，参数属性会报 TS2300 重复标识符
  constructor(
    @Optional() readFileFn: ReadFileFn = DEFAULT_READ_FILE,
    // 数据目录经 ConfigService 集中读取；直连构造（单测只传 reader）无注入时回落原解析链
    @Optional() config?: ConfigService
  ) {
    this.readFileFn = readFileFn
    this.dataDir = config ? config.dataDir : resolveDataDir()
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
