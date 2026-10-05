// @vitest-environment node
/**
 * protocol-single-source 守卫的自测（含"能让它红"的样本入库，AGENTS §七-5 / §5.4）。
 * 按 AGENTS.md §5.3 的**变异四式**逐格覆盖：
 *   式 1 删字面   → 红样本：指针文件被删 / 指向正本的引用被删
 *   式 2 停用     → 红样本：表头唯一性判据的输入被清空（正本缺席）
 *   式 3 等价重构 → **不许红**：只改指针文件的措辞与结构，保持指针，必须仍绿
 *   式 4 同义改写违约 → 红样本：换排版复制条文（编号列表 / 引用块 / 引用套列表 / 多层引用）——
 *                后三种是仓外变异复跑打出来的真漏口，见下方「式 4 前缀叠加」用例
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  DOC_SIZE_CEILINGS,
  POINTER_FILES,
  PROTOCOL_SOURCE,
  auditProtocolSingleSource,
  normLine,
} from '../protocol-single-source.mjs'
import { GUARDS } from '../run-all.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function realTexts() {
  const files = new Set([
    PROTOCOL_SOURCE,
    ...POINTER_FILES,
    ...DOC_SIZE_CEILINGS.map((s) => s.file),
  ])
  const texts = {}
  for (const f of files) texts[f] = readFileSync(path.join(ROOT, f), 'utf8')
  return texts
}

/** 从正本里取一条足够长的真实条文行（不在测试里硬抄，避免测试自身成为副本）。 */
function aSourceLine(texts, min = 30) {
  const line = texts[PROTOCOL_SOURCE].split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length >= min && !/^\||^[-*>#`]+$/.test(l))
  expect(line, '正本里应存在足够长的条文行供变异').toBeTruthy()
  return line
}

describe('protocol-single-source 守卫', () => {
  it('当前仓库：正本唯一、指针无复制 ⇒ 绿', () => {
    expect(auditProtocolSingleSource(realTexts())).toEqual([])
  })

  it('该守卫已登记进 run-all 的 GUARDS（否则等于不存在）', () => {
    expect(GUARDS).toContain('protocol-single-source')
  })

  it('@guard-red-sample 🔴 式 1 删字面：指针文件被删 → 必须报，不得静默通过', () => {
    const texts = realTexts()
    delete texts['CLAUDE.md']
    expect(auditProtocolSingleSource(texts).join(' ')).toContain('协议指针丢失')
  })

  it('🔴 式 1 删字面：删掉指向 AGENTS.md 的引用 → 必须报"没有指向"', () => {
    const texts = realTexts()
    texts['CLAUDE.md'] = texts['CLAUDE.md'].replace(/AGENTS\.md/g, '本协议')
    expect(auditProtocolSingleSource(texts).join(' ')).toContain('没有指向')
  })

  it('🔴 式 2 停用：正本缺席（表头唯一性判据失去输入）→ 必须报错而不返回绿', () => {
    const texts = realTexts()
    delete texts[PROTOCOL_SOURCE]
    const problems = auditProtocolSingleSource(texts)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('协议正本不存在')
  })

  it('🔴 式 4 同义改写违约：把条文换成编号列表复制 → 必须仍报"原文重合"', () => {
    const texts = realTexts()
    const line = aSourceLine(texts)
    texts['CLAUDE.md'] += `\n\n1. ${line}\n2. 另一条\n`
    const problems = auditProtocolSingleSource(texts)
    expect(problems.join(' ')).toContain('原文重合')
  })

  // 这一格是 2026-09-24 用仓外变异复跑打出来的真漏：normLine 单趟剥前缀时，
  // `> - 条文` 归一后仍留 `- `，与正本的 `条文` 不相等 ⇒ 把条文整段塞进引用块就能绕过查重，
  // 而这恰是本守卫注释承诺要抓的形态。修成定点循环后，以下三种叠加写法必须全部报红。
  it('🔴 式 4 前缀叠加（引用块 / 引用套列表 / 多层引用）复制 → 三种都必须报"原文重合"', () => {
    for (const wrap of [(l) => `> ${l}`, (l) => `> - ${l}`, (l) => `> > ${l}`]) {
      const texts = realTexts()
      const line = aSourceLine(texts)
      texts['CLAUDE.md'] += `\n\n${wrap(line)}\n`
      expect(auditProtocolSingleSource(texts).join(' ')).toContain('原文重合')
    }
  })

  it('式 3 等价重构不许红：同一条文各自单独归一，结果必须相等（防归一化过度）', () => {
    const line = aSourceLine(realTexts())
    const bare = normLine(line.replace(/^([-*+]|\d+[.)])\s+/, ''))
    expect(normLine(`> - ${bare}`)).toBe(bare)
    expect(normLine(`> > **${bare.replace(/\*\*/g, '')}**`)).toBe(bare)
  })

  it('🔴 式 4 同义改写违约：照搬章节标题结构（改名不改结构也算）→ 必须报"章节结构"', () => {
    const texts = realTexts()
    texts['CLAUDE.md'] += '\n\n## 七、我们的十条底线\n\n见正文。\n'
    expect(auditProtocolSingleSource(texts).join(' ')).toContain('章节结构')
  })

  it('🔴 出现第二份禁忌表 → 必须报"恰好 1 份"并点名两份文件', () => {
    const texts = realTexts()
    const header = texts[PROTOCOL_SOURCE].match(/^\|\s*#?\s*\|\s*禁忌\s*\|/m)
    expect(header, '正本必须仍有禁忌表头，否则本判据空转').toBeTruthy()
    texts['docs/README.md'] = `# 索引\n\n${header[0]}\n| - | - |\n| 1 | 示例 |\n`
    const problems = auditProtocolSingleSource(texts).join(' ')
    expect(problems).toContain('恰好 1 份')
    expect(problems).toContain('docs/README.md')
  })

  it('🔴 协议里写死门禁条数 → 必须报（真值只有 GUARDS 一处）', () => {
    const texts = realTexts()
    texts[PROTOCOL_SOURCE] += `\n本门禁共 ${GUARDS.length} 项守卫，全部必跑。\n`
    expect(auditProtocolSingleSource(texts).join(' ')).toContain('写死了门禁条数')
  })

  it('✅ 式 3 等价重构不红：指针文件换措辞/换排版，只要仍指向正本就不报', () => {
    let texts = realTexts()
    const refactored = texts['CLAUDE.md']
      .replace(/^# CLAUDE\.md.*$/m, '# Claude 入口说明')
      .replace(/\| --- \|.*$/gm, '| --- | --- |')
      .replace(/\*\*/g, '')
    texts = { ...texts, 'CLAUDE.md': refactored }
    expect(auditProtocolSingleSource(texts)).toEqual([])
  })

  it(`🔴 式 1 删字面：规范文件缺行数指针句 → 必须报`, () => {
    const spec = DOC_SIZE_CEILINGS.find((s) => s.file !== PROTOCOL_SOURCE)
    const texts = realTexts()
    // 约定文件可以有多句同义指针（1004-12 改双指针句的形态）；删字面必须把**指向执行体的
    // 引用全删**。只删第一句时，第二句仍含 SIZE_POINTER 三要素 ⇒ 红样假绿（2026-10-06 实测）。
    texts[spec.file] = texts[spec.file].replace(
      /[^。\n]*protocol-single-source\.mjs[^。\n]*。?/g,
      ''
    )
    expect(auditProtocolSingleSource(texts).join(' ')).toContain('缺行数指针')
  })

  it('🔴 式 2 停用：文件超出体量上限 → 必须报超限（含指针句也拦不住）', () => {
    const spec = DOC_SIZE_CEILINGS.find((s) => s.file !== PROTOCOL_SOURCE)
    const padded = Array(spec.max + 5)
      .fill('填充行内容保证超过上限阈值')
      .join('\n')
    const texts = { ...realTexts(), [spec.file]: padded }
    const problems = auditProtocolSingleSource(texts).join(' ')
    expect(problems).toContain('体量超限')
    expect(problems).toContain(spec.file)
  })
})
