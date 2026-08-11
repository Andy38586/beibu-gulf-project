/**
 * 后端统一 logger：debug/info 仅 dev 输出，warn/error/audit 生产保留（test 静默）。
 * 零依赖文件输出 + 按天轮转（app-YYYY-MM-DD.log，单文件 20MB 滚动，保留 14 天），
 * 业务代码 import 签名不变
 */

import { appendFile, mkdir, readdir, stat, unlink } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const isDev = process.env.NODE_ENV === 'development'
const isTest = process.env.NODE_ENV === 'test'

const __dirname = dirname(fileURLToPath(import.meta.url))
// 日志目录，可通过 LOG_DIR 覆盖（容器内默认 /app/backend/logs）
const LOG_DIR = process.env.LOG_DIR || join(__dirname, '../logs')
const MAX_SIZE = 20 * 1024 * 1024 // 单文件 20MB 上限
const MAX_FILES = 14 // 保留 14 天

let currentFile = null
let currentSize = 0

function stringify(arg) {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return arg.stack || arg.message
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

// 超过保留期的日志文件清理（仅在打开新文件时触发，避免每行扫描）
async function cleanupOld() {
  let files
  try {
    files = await readdir(LOG_DIR)
  } catch {
    return
  }
  const now = Date.now()
  const maxAge = MAX_FILES * 24 * 60 * 60 * 1000
  await Promise.all(
    files
      .filter((f) => f.startsWith('app-') && f.endsWith('.log'))
      .map((f) => {
        const m = f.match(/app-(\d{4}-\d{2}-\d{2})/)
        if (m && now - new Date(m[1]).getTime() > maxAge) {
          return unlink(join(LOG_DIR, f)).catch(() => {})
        }
        return null
      })
      .filter(Boolean)
  )
}

// 选择当日文件，必要时按大小滚动，并异步清理旧文件
async function rotateAndAppend(line) {
  const stamp = new Date().toISOString().slice(0, 10)
  const base = join(LOG_DIR, `app-${stamp}.log`)
  if (currentFile !== base) {
    currentFile = base
    try {
      currentSize = (await stat(base)).size
    } catch {
      currentSize = 0
    }
    cleanupOld().catch(() => {})
  }
  if (currentSize >= MAX_SIZE) {
    // 单文件超限，加时间戳序号滚动，避免无限增长
    currentFile = join(LOG_DIR, `app-${stamp}-${Date.now()}.log`)
    currentSize = 0
  }
  await mkdir(LOG_DIR, { recursive: true })
  await appendFile(currentFile, line)
  currentSize += Buffer.byteLength(line)
}

/**
 * 写一行日志到文件（异步、fire-and-forget）。
 * 导出仅供测试 await，不影响业务 API。
 */
export async function appendLogLine(level, args) {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${args
    .map(stringify)
    .join(' ')}\n`
  await rotateAndAppend(line)
}

function emit(level, args) {
  if (isTest) return
  // 控制台：仅 dev 双写（保持原行为）
  if (isDev) {
    const timestamp = new Date().toISOString()
    const fn = level === 'debug' ? console.log : console[level]
    fn(`[${timestamp}] [${level.toUpperCase()}]`, ...args)
  }
  // 文件：生产/非 test 环境落盘（异常吞掉，避免日志写失败拖垮主流程）
  if (!isTest) appendLogLine(level, args).catch(() => {})
}

export const logger = {
  debug: (...args) => {
    if (isDev) emit('debug', args)
  },
  info: (...args) => {
    if (isDev) emit('info', args)
  },
  warn: (...args) => emit('warn', args),
  error: (...args) => emit('error', args),
  /** 操作审计日志（生产保留，记录成功操作） */
  audit: (action, detail) => emit('info', [`[AUDIT] ${action}`, detail]),
}
