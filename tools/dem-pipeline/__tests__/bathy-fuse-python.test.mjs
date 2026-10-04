/**
 * 14-bathy-fuse 的 pytest 接线（04-F6：工具不可用记 SKIPPED，不判红也不判绿）。
 *
 * 钉的是《近岸测深数据需求-2026-10-04》的四条红线与两条基准换算路径：
 * 缺来源/缺基准/分辨率超标/零覆盖/无 CRS 拒收；LLD→EGM96 h=Z−d；融合只作用在海侧有效格。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PY = path.join(ROOT, 'backend', 'algorithm-service', '.venv', 'Scripts', 'python.exe')
const TEST_FILE = path.join(ROOT, 'tools', 'dem-pipeline', 'test_bathy_fuse.py')

describe('近岸测深 · 融合与验收入口（python）', () => {
  it.skipIf(!fs.existsSync(PY))(
    '红线拒收 / 基准换算 / 融合面（pytest 7 例）',
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
