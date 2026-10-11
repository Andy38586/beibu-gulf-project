// @vitest-environment node
/**
 * no-ephemeral 的自测（含红样）。
 *
 * 该守卫此前只有 CLI 一个入口、无任何导出 ⇒ 无法喂违例输入，也就没法证明
 * 「它在违例时会红」。本笔把核心判定 `scanFile` 与模式表 `PATTERNS` 导出，
 * 于是红样可写：造一个含审查编号的临时源文件，断言它必报。
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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

  it('基线豁免阳性路径：frontend 文件命中基线 → 放行；无基线/后端侧 → 必报（D18 假绿洞修复）', () => {
    // 夹具必须落在 frontend/ 之下：scanFile 内部以 path.relative(ROOT, file) 查基线，
    // 旧用例的 tmp 目录 rel 是 ../ 开头、与任何基线键永不相等 ⇒ 豁免分支从未被走到
    //（旧用例在该分支整体删除后依然全绿，D18 判其假绿）。
    // 三级上溯：__tests__ → v3-guard → tools → 仓库根（resolve 以末段为文件，与本体 ROOT 同口径）
    const ROOT = resolve(fileURLToPath(import.meta.url), '../../../..')
    const dir = join(ROOT, 'frontend', 'd18-fixture')
    mkdirSync(dir, { recursive: true })
    const p = join(dir, 'sample.ts')
    const content = '// 批次1 的修复'
    writeFileSync(p, content)
    const rel = relative(ROOT, p).replaceAll('\\', '/')
    const baseline = new Map([[rel, new Set([content])]])
    console.log(
      '[D18-debug] rel =',
      JSON.stringify(rel),
      '| baseline.has =',
      baseline.get(rel)?.has(content)
    )
    try {
      // 阳性路径：frontend + 命中基线 ⇒ 豁免放行（0 hits）
      expect(scanFile(p, true, baseline)).toEqual([])
      // 对照①：同一文件无基线 ⇒ 必报（证明夹具本身是真违例，放行来自基线而非判定失效）
      expect(scanFile(p, true, new Map()).length).toBeGreaterThan(0)
      // 对照②：同 rel 同基线但 isFrontend=false ⇒ 必报（豁免只对前端生效）
      expect(scanFile(p, false, baseline).length).toBeGreaterThan(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
