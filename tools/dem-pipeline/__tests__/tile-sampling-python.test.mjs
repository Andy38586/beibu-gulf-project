/**
 * F74/F75 共享采样件的 pytest 接线（工具不可用记 SKIPPED，不判红也不判绿）。
 *
 * 钉住：tile_sample / bilinear 与改前内联实现逐位相等；07/07c/10/11 的
 * 窗口求交、nodata 补 0、四角 NaN 缺角语义不得被后续重构改掉。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PY = path.join(ROOT, 'backend', 'algorithm-service', '.venv', 'Scripts', 'python.exe')
const FILES = ['test_tile_sample.py', 'test_bilinear.py'].map((f) =>
  path.join(ROOT, 'tools', 'dem-pipeline', f)
)

describe('DEM 瓦片/双线性采样单源（python）', () => {
  it.skipIf(!fs.existsSync(PY))(
    'legacy 对拍：窗口求交 / nodata / NaN 缺角 / 越界（pytest）',
    () => {
      const r = spawnSync(PY, ['-X', 'utf8', '-m', 'pytest', ...FILES, '-q'], {
        cwd: ROOT,
        encoding: 'utf8',
      })
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
    },
    60000
  )
})
