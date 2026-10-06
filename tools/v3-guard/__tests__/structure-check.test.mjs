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

import { RENDERER_SIZE_CEILINGS, audit, auditFileSizes } from '../structure-check.mjs'

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

describe('structure-check — 渲染器体量棘轮（z016 / 裁定 A-1）', () => {
  it('@guard-red-sample 超冻结上限 → 必红（差 1 行的阳性对照不许红）', () => {
    const one = [RENDERER_SIZE_CEILINGS[0]]
    const { file, max } = one[0]
    expect(auditFileSizes([{ path: file, lines: max }], one)).toEqual([])
    const over = auditFileSizes([{ path: file, lines: max + 1 }], one)
    expect(over).toHaveLength(1)
    expect(over[0]).toContain(`> 冻结上限 ${max} 行`)
  })

  it('@guard-red-sample 登记的渲染器改名/搬家（棘轮指不到文件）→ 必红', () => {
    const problems = auditFileSizes([])
    expect(problems).toHaveLength(RENDERER_SIZE_CEILINGS.length)
    expect(problems[0]).toContain('体量棘轮登记的渲染器不存在')
  })

  it('真仓棘轮与冻结值一致（实际行数 = 上限，不是上限-1 的虚设）', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
    const root = path.resolve(here, '../../..')
    const files = RENDERER_SIZE_CEILINGS.map((c) => ({
      path: c.file,
      lines: (readFileSync(path.join(root, c.file), 'utf8').match(/\n/g) || []).length,
    }))
    expect(auditFileSizes(files)).toEqual([])
    expect(files.map((f) => f.lines)).toEqual(RENDERER_SIZE_CEILINGS.map((c) => c.max))
  })
})

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
