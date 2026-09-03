#!/usr/bin/env node
// run-algorithm-tests.cjs — 本地跑 algorithm-service pytest（ci:local 的一环）
//
// Python 解释器探测顺序（不硬编码单一 venv 路径，换机/换目录可跑）：
//   1. backend/algorithm-service/.venv/Scripts/python.exe（Windows）或 .venv/bin/python（Unix）
//   2. backend/flood-service/.venv/... （既有开发机共用 venv 的兼容路径）
//   3. 系统 python3（最后回退；缺依赖会报 ModuleNotFoundError，属环境问题非测试问题）
// 真演算用例（test_real_engine）依赖 gitignored DEM 卷，本地有 DEM 才跑——测试自身
// 会按卷缺失自动 skip 或失败（对齐 CI 行为判定）。
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const algoDir = path.join(root, 'backend', 'algorithm-service')

const candidates = [
  path.join(root, 'backend', 'algorithm-service', '.venv', 'Scripts', 'python.exe'),
  path.join(root, 'backend', 'algorithm-service', '.venv', 'bin', 'python'),
  path.join(root, 'backend', 'flood-service', '.venv', 'Scripts', 'python.exe'),
  path.join(root, 'backend', 'flood-service', '.venv', 'bin', 'python'),
]

const py = candidates.find((p) => fs.existsSync(p)) || 'python3'
console.log(`[test:algorithm] 解释器: ${py}`)

const r = spawnSync(py, ['-m', 'pytest', 'tests/', '-q'], {
  cwd: algoDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
process.exit(r.status ?? 1)
