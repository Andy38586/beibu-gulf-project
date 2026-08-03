// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let logger
let appendLogLine
let LOG_DIR

beforeAll(async () => {
  LOG_DIR = await mkdtemp(join(tmpdir(), 'gcs-log-'))
  process.env.LOG_DIR = LOG_DIR
  // 生产环境才会落盘（test 环境静默）
  process.env.NODE_ENV = 'production'
  const mod = await import('../logger.js')
  logger = mod.logger
  appendLogLine = mod.appendLogLine
})

afterEach(async () => {
  // 清空 LOG_DIR 内文件，但不替换目录——logger 模块在 import 时已捕获 LOG_DIR 常量，
  // 替换目录会导致 logger 仍写旧目录而测试读新目录（files[0] 为 undefined）。
  const files = await readdir(LOG_DIR).catch(() => [])
  await Promise.all(files.map((f) => rm(join(LOG_DIR, f), { force: true })))
})

describe('logger (d062) 文件化 + 轮转', () => {
  it('warn 落盘到当日日志文件并含 [WARN] 与内容', async () => {
    await appendLogLine('warn', ['disk almost full'])
    const files = await readdir(LOG_DIR)
    const logFile = files.find((f) => f.startsWith('app-') && f.endsWith('.log'))
    expect(logFile).toBeDefined()
    const content = await readFile(join(LOG_DIR, logFile), 'utf-8')
    expect(content).toContain('[WARN]')
    expect(content).toContain('disk almost full')
  })

  it('error 落盘含 [ERROR]', async () => {
    await appendLogLine('error', ['boom', { code: 500 }])
    const files = await readdir(LOG_DIR)
    const logFile = files.find((f) => f.startsWith('app-') && f.endsWith('.log'))
    expect(logFile).toBeDefined()
    const content = await readFile(join(LOG_DIR, logFile), 'utf-8')
    expect(content).toContain('[ERROR]')
    expect(content).toContain('"code":500')
  })

  it('logger.warn 公共 API 可用并落盘', async () => {
    logger.warn('via public api')
    // emit 内部 fire-and-forget 调 appendLogLine（异步 I/O），需等待落盘完成再读
    await new Promise((r) => setTimeout(r, 100))
    const files = await readdir(LOG_DIR)
    const logFile = files.find((f) => f.startsWith('app-') && f.endsWith('.log'))
    expect(logFile).toBeDefined()
    const content = await readFile(join(LOG_DIR, logFile), 'utf-8')
    expect(content).toContain('via public api')
  })
})
