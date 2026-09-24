// @vitest-environment node
/**
 * doc-numbers 守卫的自测（含"能让它红"的样本入库）：
 * 红样本 = ① 某处条数写错（漂移）；② 锚点被删/改写（检查失去对象）；
 *          ③ 站点文件缺失。三类都必须报，否则守卫等于没有。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { DOC_NUMBER_SITES, auditDocNumbers } from '../doc-numbers.mjs'
import { GUARDS } from '../run-all.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

/** 读一遍真实文件，供用例按需变异（每例用浅拷贝，互不污染） */
function realTexts() {
  const texts = {}
  for (const site of DOC_NUMBER_SITES) {
    texts[site.file] = readFileSync(path.join(ROOT, site.file), 'utf8')
  }
  return texts
}

describe('doc-numbers 守卫', () => {
  it('当前仓库的 7 处条数均等于 run-all.mjs 的真实守卫数', () => {
    expect(auditDocNumbers(realTexts(), GUARDS.length)).toEqual([])
  })

  it('🔴 红样本：任一站点条数写错必报（漂移形态，如 README 把 16 写成 9）', () => {
    const texts = realTexts()
    texts['README.md'] = texts['README.md'].replace(
      /(npm run guard:v3\s+# )(\d+)( 项 v3 守卫)/,
      '$1' + 9 + '$3'
    )
    const problems = auditDocNumbers(texts, GUARDS.length)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join(' ')).toContain('条数漂移')
    expect(problems.join(' ')).toContain('README.md')
  })

  it('🔴 红样本：锚点被删（文本改写导致检查失去对象）必报', () => {
    const texts = realTexts()
    texts['tools/README.md'] = texts['tools/README.md'].replace(
      /（\d+ 项守卫，run-all\.mjs 串联不短路）/,
      '（守卫清单见 run-all.mjs）'
    )
    const problems = auditDocNumbers(texts, GUARDS.length)
    expect(problems.join(' ')).toContain('锚点未命中')
    expect(problems.join(' ')).toContain('tools/README.md')
  })

  it('🔴 红样本：站点文件缺失（读不到文本）必报，不得静默通过', () => {
    const texts = realTexts()
    delete texts['.husky/pre-push']
    const problems = auditDocNumbers(texts, GUARDS.length)
    expect(problems.join(' ')).toContain('.husky/pre-push')
    expect(problems.join(' ')).toContain('读取失败')
  })

  it('真值变化时，未跟改的站点全部报红（守卫数从 N 涨到 N+1 即触发）', () => {
    const problems = auditDocNumbers(realTexts(), GUARDS.length + 1)
    expect(problems.length).toBe(DOC_NUMBER_SITES.length)
  })
})
