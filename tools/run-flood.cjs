#!/usr/bin/env node
/**
 * run-flood.cjs — 跨平台启动洪涝在线演算服务（FastAPI / uvicorn）
 *
 * 背景：旧脚本 `dev:flood` 硬编码 `.venv\Scripts\python.exe`（Windows-only），
 * macOS/Linux/CI 直接跑不起来（z074）。本启动器按平台解析 venv 解释器路径：
 *   - Windows: <venv>/Scripts/python.exe
 *   - macOS/Linux: <venv>/bin/python
 *
 * 用法（package.json）：
 *   "dev:flood": "node tools/run-flood.cjs"
 *
 * 首次运行若 venv 不存在，会给出创建提示后以非零码退出（不自动创建，
 * 避免隐式下载依赖）。
 */
const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

const FLOOD_DIR = path.join(__dirname, '..', 'backend', 'flood-service')
const isWin = process.platform === 'win32'
const pythonInVenv = path.join(
  FLOOD_DIR,
  '.venv',
  isWin ? 'Scripts' : 'bin',
  isWin ? 'python.exe' : 'python'
)

if (!existsSync(pythonInVenv)) {
  const createCmd = isWin
    ? `cd backend\\flood-service && python -m venv .venv && .venv\\Scripts\\pip install -r requirements.txt`
    : `cd backend/flood-service && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`
  console.error(`[run-flood] 未找到 venv 解释器: ${pythonInVenv}`)
  console.error(`[run-flood] 请先创建 venv 并安装依赖:`)
  console.error(`  ${createCmd}`)
  process.exit(1)
}

const child = spawn(pythonInVenv, ['-m', 'uvicorn', 'main:app', '--port', '8000', '--log-level', 'warning'], {
  cwd: FLOOD_DIR,
  stdio: 'inherit',
})

child.on('error', (err) => {
  console.error(`[run-flood] 启动失败: ${err.message}`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

// Ctrl+C / SIGTERM 时把信号透传给 uvicorn 子进程
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig))
}
