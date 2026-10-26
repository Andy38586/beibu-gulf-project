/**
 * 跨平台 pytest 接线器（2026-10-26，修 P1：tools 下 11 个包装器写死 Windows venv + skipIf，
 * Linux CI 恒跳过 ⇒ 判据不存在）。解析顺序：V3_PYTHON → backend venv
 * （Windows/Linux 两种布局；algorithm-service 已退役，仅历史 venv 目录）→ PATH 上的 python3/python。
 * 找不到就 fail，不 skip。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function probe(cmd) {
  if (cmd.includes(path.sep)) return fs.existsSync(cmd) ? cmd : null
  const r = spawnSync(cmd, ['-c', 'import sys'], { encoding: 'utf8' })
  return r.status === 0 ? cmd : null
}

export function resolvePython() {
  const candidates = [
    process.env.V3_PYTHON,
    path.join(ROOT, 'backend', 'algorithm-service', '.venv', 'Scripts', 'python.exe'),
    path.join(ROOT, 'backend', 'algorithm-service', '.venv', 'bin', 'python'),
    'python3',
    'python',
  ].filter(Boolean)
  for (const c of candidates) {
    const p = probe(c)
    if (p) return p
  }
  return null
}

export function definePytestCase(title, files, timeout = 120000) {
  it(
    title,
    () => {
      const py = resolvePython()
      if (!py) {
        expect.fail(
          '找不到 Python（V3_PYTHON / backend venv / python3；algorithm-service 已退役，仅历史 venv 目录）。' +
            'pytest 门禁不得 skip；CI 需 setup-python 并安装 numpy rasterio pytest。'
        )
      }
      const abs = files.map((f) => (path.isAbsolute(f) ? f : path.join(ROOT, f)))
      const missing = abs.filter((f) => !fs.existsSync(f))
      if (missing.length) expect.fail(`pytest 输入文件不存在：${missing.join(', ')}`)
      const r = spawnSync(py, ['-X', 'utf8', '-m', 'pytest', ...abs, '-q'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout,
      })
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0)
    },
    timeout
  )
}
