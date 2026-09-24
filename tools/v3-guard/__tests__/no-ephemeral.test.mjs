// @vitest-environment node
/**
 * no-ephemeral 的自测（含红样）。
 *
 * 该守卫此前只有 CLI 一个入口、无任何导出 ⇒ 无法喂违例输入，也就没法证明
 * 「它在违例时会红」。本笔把核心判定 `scanFile` 与模式表 `PATTERNS` 导出，
 * 于是红样可写：造一个含审查编号的临时源文件，断言它必报。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { scanFile } from '../no-ephemeral.mjs'

/** 造一个临时源文件，返回其绝对路径 */
function fileWith(content) {
  const dir = mkdtempSync(join(tmpdir(), 'no-ephem-'))
  const p = join(dir, 'sample.ts')
  writeFileSync(p, content)
  return p
}

describe('no-ephemeral — 施工/审查编号不得进源码', () => {
  it('纯描述注释（无编号）→ 不命中', () => {
    expect(
      scanFile(fileWith('// 注册即登记，注销随作用域\nconst a = 1\n'), false, new Map())
    ).toEqual([])
  })

  it('@guard-red-sample 含审查编号的源码行 → 必报', () => {
    const hits = scanFile(fileWith('// 这是 M5 结构约束，见台账\n'), false, new Map())
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].text).toContain('M5')
  })

  it('@guard-red-sample 另一种编号形态（专项N）同样必报', () => {
    const hits = scanFile(fileWith('// 专项4 的结论落在这一行\n'), false, new Map())
    expect(hits.length).toBeGreaterThan(0)
  })

  it('基线豁免只对前端生效；后端侧同形命中不被放过', () => {
    const p = fileWith('// 批次1 的修复\n')
    const baseline = new Map([['sample.ts', new Set(['// 批次1 的修复'])]])
    // isFrontend=false（后端侧）：基线不豁免
    expect(scanFile(p, false, baseline).length).toBeGreaterThan(0)
  })
})
