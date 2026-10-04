/**
 * flood_realify 生成侧契约的 pytest 接线（04-F6：工具不可用记 SKIPPED，不判红也不判绿）。
 *
 * 为什么要有这层包装：本条钉的是"生成物必须带本次 DEM 的 md5""废弃件不许复活"
 * "整窗无陆地时不编高程"——都由 tools/flood/test_flood_realify.py 在临时目录里跑，
 * venv 缺失时跳过并在报告里可见。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PY = path.join(ROOT, 'backend', 'algorithm-service', '.venv', 'Scripts', 'python.exe')
const TEST_FILE = path.join(ROOT, 'tools', 'flood', 'test_flood_realify.py')

describe('flood 生成侧 · 溯源与废弃件收口（python）', () => {
  it.skipIf(!fs.existsSync(PY))('DEM md5 接线 / 不写废弃件 / 无陆地写 null（pytest 2 例）', () => {
    const r = spawnSync(PY, ['-m', 'pytest', TEST_FILE, '-q'], { cwd: ROOT, encoding: 'utf8' })
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
  })
})
