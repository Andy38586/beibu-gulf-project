#!/usr/bin/env node
/**
 * doc-numbers.mjs — 文档里写死的「门禁条数」必须等于 run-all.mjs 的真实守卫数。
 *
 * 为什么需要：`guard:v3` 的守卫数从 8 → 9 → 13 → 15 一路长，而散落在 `.husky/pre-push`、
 * `README.md`、`tools/README.md`、`核心流程与数据流.md` 里的叙述一直停在 8/9（实核 6 处，
 * 另 `.husky/pre-commit` 一处写 13）。数字写错本身不痛，痛的是**它读起来像权威口径**：
 * 后来者按"9 项"判断覆盖面，就会漏掉一半守卫；反之把守卫数当成装饰，也无人会去核对。
 * 这类"文档自述与实现脱节"在本仓已有前科（AGENTS 协议自述、agent-docs-check 断言 1/2/4），
 * 但那些只校验**路径存在**，不校验**数字一致** ⇒ 本条补上。
 *
 * 判据（两类，缺一即报）：
 *   ① 锚点在位——每个站点必须能在对应文件里命中，命中 0 次说明文本被删/被改写，
 *      检查对象消失（"守卫静默失效"比数字错更危险，参考 tmp-hygiene 2026-09-18 的教训）；
 *   ② 数字一致——命中处捕获到的数字必须 === GUARDS.length（真值从 run-all.mjs 读取，
 *      不许在文档或本文件里再抄一份）。
 *
 * 用法：node tools/v3-guard/doc-numbers.mjs    （违例 exit 1）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { GUARDS } from './run-all.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * 站点表：文件 + 定位「门禁条数」的正则（**必须有且只有一个捕获组**，捕获组即条数）。
 * 正则锚在语境词上，避免把无关数字卷进来。
 */
export const DOC_NUMBER_SITES = [
  {
    file: '.husky/pre-push',
    re: /\[pre-push\] 1\/\d+ v3 守卫（(\d+) 项/,
    note: 'pre-push 第 1 步标题',
  },
  {
    file: '.husky/pre-commit',
    re: /guard:v3（(\d+) 项静态守卫/,
    note: 'pre-commit 快集清单注释',
  },
  {
    file: 'README.md',
    re: /npm run guard:v3\s+# (\d+) 项 v3 守卫/,
    note: 'README 常用命令表',
  },
  {
    file: 'README.md',
    re: /`static-checks` 跑 (\d+) 项 v3 守卫/,
    note: 'README CI job 说明',
  },
  {
    file: 'docs/根基文档/核心流程与数据流.md',
    re: /npm run guard:v3\s+# (\d+) 项 v3 守卫/,
    note: '核心流程命令块',
  },
  {
    file: 'tools/README.md',
    re: /(\d+) 项 CI 断言/,
    note: 'tools/README 工具表 v3-guard 行',
  },
  {
    file: 'tools/README.md',
    re: /（(\d+) 项守卫，run-all\.mjs 串联不短路）/,
    note: 'tools/README 命令块',
  },
]

/**
 * 纯函数便于单测：文件文本表 + 真值 → 问题列表（空数组 = 通过）
 * @param {Record<string, string>} texts 文件相对路径 → 文本（缺键按"文件不存在"报）
 * @param {number} truth run-all.mjs 的实际守卫数
 * @returns {string[]}
 */
export function auditDocNumbers(texts, truth) {
  const problems = []
  for (const site of DOC_NUMBER_SITES) {
    const text = texts[site.file]
    if (text === undefined) {
      problems.push(`✗ ${site.file}（${site.note}）读取失败：文件不存在或未提供`)
      continue
    }
    const found = [...text.matchAll(new RegExp(site.re.source, 'g'))]
    if (found.length === 0) {
      problems.push(
        `✗ ${site.file}（${site.note}）锚点未命中：找不到 \`${site.re.source}\` —— ` +
          '文本被删/改写，条数检查已失去对象（守卫自身失效）'
      )
      continue
    }
    for (const m of found) {
      if (Number(m[1]) !== truth) {
        problems.push(
          `✗ ${site.file}（${site.note}）条数漂移：写的是 ${m[1]} 项，run-all.mjs 实际 ${truth} 项`
        )
      }
    }
  }
  return problems
}

function main() {
  const texts = {}
  for (const site of DOC_NUMBER_SITES) {
    if (texts[site.file] !== undefined) continue
    const abs = path.join(ROOT, site.file)
    texts[site.file] = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined
  }
  const problems = auditDocNumbers(texts, GUARDS.length)
  if (problems.length > 0) {
    console.error('[doc-numbers] 未通过：文档里的门禁条数与 run-all.mjs 不一致')
    for (const p of problems) console.error('  ' + p)
    console.error(
      `处理：把这些位置的条数改成 ${GUARDS.length}（真值取自 tools/v3-guard/run-all.mjs 的 GUARDS）。`
    )
    process.exit(1)
  }
  console.log(
    `[doc-numbers] OK：${DOC_NUMBER_SITES.length} 处门禁条数均等于 run-all.mjs 的 ${GUARDS.length} 项 ✓`
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
