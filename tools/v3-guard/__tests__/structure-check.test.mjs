// @vitest-environment node
/**
 * structure-check 的自测（含红样）。
 *
 * 该守卫此前逻辑全在顶层，只能整体跑真实仓库 ⇒ 喂不了违例输入。本笔把核心审计
 * 提成 `audit(modulesDir)`（目录可注入），红样因此可写。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { audit } from '../structure-check.mjs'

/** 造一个 modules 目录：{ 模块名: [文件名...] } */
function modulesDir(modules) {
  const dir = mkdtempSync(join(tmpdir(), 'struct-'))
  for (const [name, files] of Object.entries(modules)) {
    mkdirSync(join(dir, name))
    for (const f of files) writeFileSync(join(dir, name, f), '')
  }
  return dir
}

const FULL = ['foo.module.ts', 'foo.controller.ts', 'foo.service.ts']

describe('structure-check — 后端模块分层契约', () => {
  it('合规模块（module + controller + service）→ 无问题', () => {
    expect(audit(modulesDir({ foo: FULL }))).toEqual([])
  })

  it('@guard-red-sample 缺 module.ts → 必报', () => {
    const p = audit(modulesDir({ foo: ['foo.controller.ts', 'foo.service.ts'] }))
    expect(p.length).toBeGreaterThan(0)
    expect(p.join(' ')).toContain('缺少 foo.module.ts')
  })

  it('@guard-red-sample 残留临时文件（.tmp）→ 必报', () => {
    expect(audit(modulesDir({ foo: [...FULL, 'x.tmp'] })).join(' ')).toContain('残留临时文件')
  })

  it('@guard-red-sample 空层目录（controllers/ 为空）→ 必报', () => {
    const dir = modulesDir({ foo: FULL })
    mkdirSync(join(dir, 'foo', 'controllers'))
    expect(audit(dir).join(' ')).toContain('空目录应删除')
  })

  it('子目录形态（controllers//services/ 目录存在）同样合规', () => {
    const dir = modulesDir({ foo: ['foo.module.ts'] })
    for (const d of ['controllers', 'services']) {
      mkdirSync(join(dir, 'foo', d))
      writeFileSync(join(dir, 'foo', d, 'index.ts'), '')
    }
    expect(audit(dir)).toEqual([])
  })
})
