// @vitest-environment node
/**
 * protocol-single-source 守卫的自测（含"能让它红"的样本入库，AGENTS §七-5 / §5.4）。
 * 按 AGENTS.md §5.3 的**变异四式**逐格覆盖：
 *   式 1 删字面   → 红样本：指针文件被删 / 指向正本的引用被删
 *   式 2 停用     → 红样本：表头唯一性判据的输入被清空（正本缺席）
 *   式 3 等价重构 → **不许红**：只改指针文件的措辞与结构，保持指针，必须仍绿
 *   式 4 同义改写违约 → 红样本：把条文换成编号列表复制（不是表格，测"结构识别"而非"格式识别"）
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  POINTER_FILES,
  PROTOCOL_SOURCE,
  auditProtocolSingleSource,
} from '../protocol-single-source.mjs'
import { GUARDS } from '../run-all.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function realTexts() {
  const texts = { [PROTOCOL_SOURCE]: readFileSync(path.join(ROOT, PROTOCOL_SOURCE), 'utf8') }
  for (const f of POINTER_FILES) texts[f] = readFileSync(path.join(ROOT, f), 'utf8')
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

  it('🔴 式 1 删字面：指针文件被删 → 必须报，不得静默通过', () => {
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
})
