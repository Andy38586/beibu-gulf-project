// @vitest-environment node
/**
 * tmp-hygiene 的自测（含红样）。
 *
 * 该守卫此前 `scan()` 绑死 ROOT/WATCHED，只能整体跑真实仓库 ⇒ 无法喂违例输入。
 * 本笔把 scan 参数化（root/watch 可注入），于是红样可写：造一个含临时命名文件的
 * 临时目录，断言它必报。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { scan } from '../tmp-hygiene.mjs'

/** 造一个含指定文件名的临时目录 */
function dirWith(names) {
  const dir = mkdtempSync(join(tmpdir(), 'tmp-hyg-'))
  for (const n of names) writeFileSync(join(dir, n), '')
  return dir
}

describe('tmp-hygiene — 受控目录不得残留临时条目', () => {
  it('干净目录 → 无命中', () => {
    expect(scan({ root: dirWith(['index.ts', 'README.md']), watched: ['.'] })).toEqual([])
  })

  it('@guard-red-sample 草稿命名前缀（scratch-）→ 必报', () => {
    const hits = scan({ root: dirWith(['scratch-x.ts']), watched: ['.'] })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].why).toContain('草稿命名前缀')
  })

  it('@guard-red-sample 备份扩展名（.bak）→ 必报', () => {
    const hits = scan({ root: dirWith(['a.bak']), watched: ['.'] })
    expect(hits.length).toBeGreaterThan(0)
  })

  it('合法长驻文件名（README.md）不被误报', () => {
    expect(scan({ root: dirWith(['README.md']), watched: ['.'] })).toEqual([])
  })
})
