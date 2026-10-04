/**
 * flood_engine 永久水体种子的 pytest 接线（04-F6：工具不可用记 SKIPPED，不判红也不判绿）。
 *
 * 为什么要有这层包装：种子语义（无测深 DEM 退回 NoData、含测深 DEM 认与开海连通的
 * dem<=0 分量）是全部淹没产物的唯一分歧点，但用例必须跑在装有 numpy/scipy 的
 * Python venv 里（backend/algorithm-service/.venv，不入库）。本包装把它接进
 * `npm run test:tools`，venv 缺失时跳过并在报告里可见。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PY = path.join(ROOT, 'backend', 'algorithm-service', '.venv', 'Scripts', 'python.exe')
const TEST_FILE = path.join(ROOT, 'tools', 'flood', 'engine', 'test_flood_engine.py')

describe('flood engine · 永久水体种子（python）', () => {
  it.skipIf(!fs.existsSync(PY))('陆地 DEM 行为不变 / 含测深 DEM 连通正确（pytest 6 例）', () => {
    const r = spawnSync(PY, ['-m', 'pytest', TEST_FILE, '-q'], { cwd: ROOT, encoding: 'utf8' })
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
  })
})
