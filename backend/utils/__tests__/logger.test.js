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
  // d062: 生产环境才会落盘（test 环境静默）
  process.env.NODE_ENV = 'production'
  const mod = await import('../logger.js')
  logger = mod.logger
  appendLogLine = mod.appendLogLine
})

afterEach(async () => {
  await rm(LOG_DIR, { recursive: true, force: true })
  await mkdtemp(join(tmpdir(), 'gcs-log-')).then((d) => {
    LOG_DIR = d
    process.env.LOG_DIR = d
  })
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
    const content = await readFile(join(LOG_DIR, files[0]), 'utf-8')
    expect(content).toContain('[ERROR]')
    expect(content).toContain('"code":500')
  })

  it('logger.warn 公共 API 可用并落盘', async () => {
    logger.warn('via public api')
    const files = await readdir(LOG_DIR)
    const content = await readFile(join(LOG_DIR, files[0]), 'utf-8')
    expect(content).toContain('via public api')
  })
})
