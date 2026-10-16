/**
 * GLB 读链单源（tools/lib/glb.py）的 pytest 接线
 * （04-F6：工具不可用记 SKIPPED，不判红也不判绿）。
 *
 * 钉的是 P4-PY 的补做半边：12 个站点曾各自手抄 chunk 类型字面量、accessor 的
 * componentType/type 映射与 byteStride 步长；缺了这条，任一站把读链搬回来都不会有人发现
 * （同源 JS 侧暂无判据，见接力状态 P4 台账的「JS 面 4 站点」在册项）。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PY = path.join(ROOT, 'backend', 'algorithm-service', '.venv', 'Scripts', 'python.exe')
const TEST_FILE = path.join(ROOT, 'tools', 'lib', 'test_glb.py')

describe('GLB 读链单源 · Python 侧（python）', () => {
  it('被测 pytest 文件在解析出的 ROOT 下存在', () => {
    expect(fs.existsSync(TEST_FILE), TEST_FILE).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'tools', 'lib', 'glb.py'))).toBe(true)
  })

  it.skipIf(!fs.existsSync(PY))('12 站点无手抄 / 权威源真语料取数（pytest 5 例）', () => {
    const r = spawnSync(PY, ['-m', 'pytest', TEST_FILE, '-q'], { cwd: ROOT, encoding: 'utf8' })
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
  })
})
