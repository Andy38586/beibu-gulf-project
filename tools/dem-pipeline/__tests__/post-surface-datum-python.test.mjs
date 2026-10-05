/**
 * 07b-post-surface 基准判别的 pytest 接线（工具不可用记 SKIPPED，不判红也不判绿）。
 *
 * 钉的是 2026-10-05 统一基准后的水位换算跟随规则：
 * 换算跟随 DEM 基准而非 grid 存在性；椭球件缺 grid fail-loud；缺省 DEM 椭球件优先。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PY = path.join(ROOT, 'backend', 'algorithm-service', '.venv', 'Scripts', 'python.exe')
const TEST_FILE = path.join(ROOT, 'tools', 'dem-pipeline', 'test_post_surface_datum.py')

describe('地形链 · 07b 基准判别（python）', () => {
  it.skipIf(!fs.existsSync(PY))(
    '水位换算跟随 DEM 基准 / fail-loud / 缺省解析（pytest 6 例）',
    () => {
      const r = spawnSync(PY, ['-X', 'utf8', '-m', 'pytest', TEST_FILE, '-q'], {
        cwd: ROOT,
        encoding: 'utf8',
      })
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
    },
    60000
  )
})
