/**
 * 天地图取图三件套单源（tools/lib/tianditu.py）的 pytest 接线
 * （工具不可用记 SKIPPED，不判红也不判绿——照 tools/lib/__tests__/geo-python.test.mjs）。
 *
 * 钉的是必要审判波二·单元 O 的 Python 半边：key 探测顺序与 Web Mercator 瓦片公式
 * 曾在 tools/3dtiles-build/fetch-port-imagery.py 与 tools/diag/fetch-imagery.py 各手抄一份，
 * 缺了这条，任一站点把公式搬回来都不会有人发现。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PY = path.join(ROOT, 'backend', 'algorithm-service', '.venv', 'Scripts', 'python.exe')
const TEST_FILE = path.join(ROOT, 'tools', 'lib', 'test_tianditu.py')

describe('天地图取图三件套单源 · Python 侧（python）', () => {
  it('被测 pytest 文件在解析出的 ROOT 下存在', () => {
    expect(fs.existsSync(TEST_FILE), TEST_FILE).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'tools', 'lib', 'tianditu.py'))).toBe(true)
  })

  it.skipIf(!fs.existsSync(PY))('两站点无手抄 / 权威源行为冻结（pytest 4 例）', () => {
    const r = spawnSync(PY, ['-m', 'pytest', TEST_FILE, '-q'], { cwd: ROOT, encoding: 'utf8' })
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
  })
})
