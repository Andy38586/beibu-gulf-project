/**
 * 06-sea-mask 三条判据的 pytest 接线（04-F6：工具不可用记 SKIPPED，不判红也不判绿）。
 *
 * 钉的是 2026-10-04 修正的掩膜规则：海 = 海岸线 ∩ 测深源(<=0/无值) ∩ 源DEM不判陆(<=0)。
 * 缺任一条就会重演"域内 1139.8 km² 陆地被吞"或"港区码头被抹成水深"。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PY = path.join(ROOT, 'backend', 'algorithm-service', '.venv', 'Scripts', 'python.exe')
const TEST_FILE = path.join(ROOT, 'tools', 'dem-pipeline', 'test_sea_mask.py')

describe('海陆 DEM · 海掩膜三条判据（python）', () => {
  it.skipIf(!fs.existsSync(PY))('海岸线 / 测深确认 / 源 DEM 判陆（pytest 5 例）', () => {
    const r = spawnSync(PY, ['-m', 'pytest', TEST_FILE, '-q'], { cwd: ROOT, encoding: 'utf8' })
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
  })
})
