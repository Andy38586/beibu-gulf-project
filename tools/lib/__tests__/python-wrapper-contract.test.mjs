/**
 * Python 包装器契约：tools 下所有 *python*.test.mjs 必须走 definePytestCase，
 * 不得用 skipIf/it.skip 把 pytest 判据变成静默跳过（2026-10-26 P1 复查）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const TOOLS = path.join(ROOT, 'tools')

function collect(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collect(p, out)
    else if (
      /__tests__[\\/].*python.*\.test\.mjs$/.test(p) &&
      !p.endsWith('python-wrapper-contract.test.mjs')
    ) {
      out.push(p)
    }
  }
  return out
}

describe('Python pytest 包装器契约', () => {
  it('至少找到 10 个包装器（防止扫描面退化为空）', () => {
    expect(collect(TOOLS).length).toBeGreaterThanOrEqual(10)
  })

  it('@guard-red-sample 不得出现 skipIf / it.skip（工具缺失必须 fail，不得静默跳过）', () => {
    const offenders = collect(TOOLS).filter((p) =>
      /\.skipIf\s*\(|\bit\.skip\s*\(/.test(fs.readFileSync(p, 'utf8'))
    )
    expect(offenders.map((p) => path.relative(ROOT, p))).toEqual([])
  })
})
