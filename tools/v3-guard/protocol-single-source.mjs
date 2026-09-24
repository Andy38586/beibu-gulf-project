#!/usr/bin/env node
/**
 * protocol-single-source.mjs — 作业协议只允许有一份，副本必须是指针。
 *
 * 为什么需要：`CLAUDE.md` 长期手抄 `AGENTS.md` 的「三条铁律 / 六类禁忌 / 八条必停」，
 * 只在开头挂一句"冲突时以 AGENTS.md 为准"。这一句救不了不读 AGENTS.md 的那个 agent；
 * 而协议每长一条禁忌，抄本就以"看起来像权威"的形态落后一截——这正是 04-B3 /
 * `AGENTS.md` §七-7「无权威源的多份副本；半覆盖的同步比没有同步更危险」在**协议自身**上的实例。
 * 2026-09-24 把禁忌扩到十条时，抄本当场变成第二个口径 ⇒ 立此守卫收口。
 *
 * 三道网（全部只认结构，**不嵌入条文名**——把禁忌名写进本文件，本守卫自己就成了第二份副本）：
 *   ① 指针文件必须指向正本，且不得复制协议结构（中文序号章节标题）或与正本逐行重合；
 *   ② 含「禁忌表头」的 Markdown 全仓恰好 1 份且在正本（集合由文件系统扫描派生，不写清单）；
 *   ③ 协议文件不得写死门禁条数（真值只有 run-all.mjs 的 GUARDS；要带数字请登记 doc-numbers 站点）。
 *
 * 已知漏口（如实写，不假装完备）：换一套措辞、另起一个非"一、二、三"式标题手工重排条文，
 * 本守卫认不出。它能拦的是**最常见的两种漂移**：整段复制、和结构照搬。
 *
 * 用法：node tools/v3-guard/protocol-single-source.mjs    （违例 exit 1）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 协议正本。引用它的文件叫"指针文件"，指针文件里不许有条文副本。 */
export const PROTOCOL_SOURCE = 'AGENTS.md'
/** 已知会引用协议的 agent 配置文件（新增同类文件加入此表即可，判据②仍靠扫描）。 */
export const POINTER_FILES = ['CLAUDE.md']

/** (①-a) 指针文件里出现"中文序号 + 、"式协议章节标题 = 复制了协议结构。 */
const PROTOCOL_SECTION_HEADING = /^#{2,3}\s*[一二三四五六七八九十]+、/m
/** (①-b) 与正本逐行重合的最小长度；短行（`---`、通用命令）不算复制。 */
const COPY_LINE_MIN = 24
/** (①-b) 比对时跳过的行：表格分隔线、纯符号行。 */
const COPY_LINE_SKIP = /^(\||[-*>#`|\s-]+$|^\s*$)/
/**
 * (①-b) 行归一化：剥掉列表符号、引用符号、行首序号与成对加粗标记。
 * 目的：**换一种排版复制同一条文（表格→编号列表、加粗→不加粗、加 `>` 引用）仍算复制**。
 * 若只比原文，改一下前缀就能绕过——那是 §5.3 式 4 要抓的形态。
 * @param {string} line
 */
export function normLine(line) {
  return line
    .trim()
    .replace(/^([-*+]|\d+[.)])\s+/, '')
    .replace(/^>+\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim()
}
/** (②) 禁忌表头形态。 */
const TABOO_HEADER = /^\|\s*#?\s*\|\s*禁忌\s*\|/m
/** (③) 写死的门禁条数。 */
const GUARD_COUNT_LITERAL = /\d+\s*项(?:静态)?守卫|\(\s*\d+\s*项守卫/

/**
 * 纯函数便于单测：文件文本表 → 问题列表（空数组 = 通过）
 * @param {Record<string, string | undefined>} texts 相对路径 → 文本
 * @returns {string[]}
 */
export function auditProtocolSingleSource(texts) {
  const problems = []
  const source = texts[PROTOCOL_SOURCE]
  if (source === undefined) {
    return [`✗ ${PROTOCOL_SOURCE} 读取失败：协议正本不存在（判据失去对象）`]
  }
  const sourceLines = new Set(
    source
      .split(/\r?\n/)
      .map(normLine)
      .filter((l) => l.length >= COPY_LINE_MIN && !COPY_LINE_SKIP.test(l))
  )

  for (const file of POINTER_FILES) {
    const text = texts[file]
    if (text === undefined) {
      problems.push(`✗ ${file} 读取失败：文件不存在（协议指针丢失）`)
      continue
    }
    if (!text.includes(PROTOCOL_SOURCE)) {
      problems.push(`✗ ${file} 没有指向 ${PROTOCOL_SOURCE} —— 读者会以为它自己是权威`)
    }
    const heading = text.match(PROTOCOL_SECTION_HEADING)
    if (heading) {
      const line = text.slice(0, heading.index).split(/\r?\n/).length
      problems.push(
        `✗ ${file}:${line} 复制了 ${PROTOCOL_SOURCE} 的章节结构（"${heading[0].trim()}"）` +
          ` ⇒ 协议一改这里就变成第二个口径，请删掉并改为指向 ${PROTOCOL_SOURCE}`
      )
    }
    const dup = []
    for (const raw of text.split(/\r?\n/)) {
      const l = normLine(raw)
      if (l.length >= COPY_LINE_MIN && !COPY_LINE_SKIP.test(l) && sourceLines.has(l)) dup.push(l)
    }
    if (dup.length > 0) {
      problems.push(
        `✗ ${file} 与 ${PROTOCOL_SOURCE} 有 ${dup.length} 行原文重合（复制条文），例如：\n` +
          dup
            .slice(0, 3)
            .map((d) => `      ${d.slice(0, 60)}`)
            .join('\n')
      )
    }
  }

  const tabooFiles = Object.entries(texts)
    .filter(([file, text]) => file.endsWith('.md') && text !== undefined && TABOO_HEADER.test(text))
    .map(([file]) => file)
  if (tabooFiles.length !== 1 || tabooFiles[0] !== PROTOCOL_SOURCE) {
    problems.push(
      `✗ 含「禁忌表头」的 Markdown 应恰好 1 份且是 ${PROTOCOL_SOURCE}；实测 ${tabooFiles.length} 份：` +
        `${tabooFiles.join('、') || '（0 份——正本表头被改，本判据已失效）'}`
    )
  }

  for (const file of [PROTOCOL_SOURCE, ...POINTER_FILES]) {
    const text = texts[file]
    if (text === undefined) continue
    const m = text.match(GUARD_COUNT_LITERAL)
    if (m) {
      const line = text.slice(0, m.index).split(/\r?\n/).length
      problems.push(
        `✗ ${file}:${line} 写死了门禁条数 "${m[0].trim()}" ⇒ 真值只有一处（run-all.mjs 的 GUARDS）；` +
          `要文档带数字就登记到 doc-numbers.mjs 的站点表，由它比对真值`
      )
    }
  }

  return problems
}

/** 扫描时跳过的目录名（第三方/产物/本机区，不可能是协议正本）。 */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.venv',
  '.git',
  '.local',
  '.workbuddy',
  '.reasonix',
  '.staging-react',
  'pdf_build',
])

function walkMd(dir, acc, depth = 0) {
  if (depth > 6) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || (entry.name.startsWith('.') && depth === 0)) continue
      walkMd(path.join(dir, entry.name), acc, depth + 1)
    } else if (entry.name.endsWith('.md')) {
      acc.push(path.relative(ROOT, path.join(dir, entry.name)).split(path.sep).join('/'))
    }
  }
  return acc
}

function collectTexts() {
  const out = {}
  for (const file of new Set([PROTOCOL_SOURCE, ...POINTER_FILES, ...walkMd(ROOT, [])])) {
    const abs = path.join(ROOT, file)
    out[file] = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined
  }
  return out
}

function main() {
  const problems = auditProtocolSingleSource(collectTexts())
  if (problems.length > 0) {
    console.error('[protocol-single-source] 未通过：作业协议出现了第二个口径')
    for (const p of problems) console.error('  ' + p)
    console.error(`处理：规则只写在 ${PROTOCOL_SOURCE}，其余文件只做指针与索引。`)
    process.exit(1)
  }
  console.log(
    `[protocol-single-source] OK：条文正本唯一（${PROTOCOL_SOURCE}），${POINTER_FILES.length} 个指针文件无复制，协议内无写死门禁条数 ✓`
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
