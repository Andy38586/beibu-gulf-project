// pytest 接线（04-F6：工具不可用记 SKIPPED，不判红也不判绿）
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PY = path.join(ROOT, 'backend', 'algorithm-service', '.venv', 'Scripts', 'python.exe')
const TEST_FILE = path.join(ROOT, 'tools', 'diag', 'test_bridge_palette.py')

describe('桥构件色单源（pytest 5 例）', () => {
  // 路径写错时不许静默 skip：先钉死被测件在解析出的 ROOT 下真实存在
  it('被测 pytest 文件在解析出的 ROOT 下存在（路径自检）', () => {
    expect(fs.existsSync(TEST_FILE), TEST_FILE).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'tools', 'lib', 'bridge-palette.mjs'))).toBe(true)
  })

  it.skipIf(!fs.existsSync(PY))('探针读权威源 · PY 侧无第二份手抄', () => {
    const r = spawnSync(PY, ['-m', 'pytest', TEST_FILE, '-q'], { cwd: ROOT, encoding: 'utf8' })
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
  })
})
