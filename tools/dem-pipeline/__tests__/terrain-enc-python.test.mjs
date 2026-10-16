/**
 * heightmap-1.0 编解码单源（tools/dem-pipeline/lib/terrain_enc.py）的 pytest 接线
 * （04-F6：工具不可用记 SKIPPED，不判红也不判绿）。
 *
 * 钉的是 task-2 / P3·D23 余项：07 / 07c / 08 / 09 与 tools/diag 两个地形探针曾各自
 * 手抄同一组编码常量与算式；缺了这条，任一站把常量搬回来都不会有人发现。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PY = path.join(ROOT, 'backend', 'algorithm-service', '.venv', 'Scripts', 'python.exe')
const TEST_FILE = path.join(ROOT, 'tools', 'dem-pipeline', 'test_terrain_enc.py')

describe('地形 heightmap-1.0 · 编解码单源（python）', () => {
  it.skipIf(!fs.existsSync(PY))('六站点无手抄 / lib 行为冻结（pytest 12 例）', () => {
    const r = spawnSync(PY, ['-m', 'pytest', TEST_FILE, '-q'], { cwd: ROOT, encoding: 'utf8' })
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
  })
})
