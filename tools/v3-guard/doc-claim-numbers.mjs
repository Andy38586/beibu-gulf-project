#!/usr/bin/env node
/**
 * doc-claim-numbers — 文档里的「自述数字」必须来自执行体（1005 RC1 门禁②）。
 *
 * 治什么：`doc-numbers` 只对账**已登记的 7 处**门禁条数；体量上限家族（「≤ 80 行」族）
 * 此前全凭人记——1004-12 实测：约定自称"≤ 80 行"而执行体表里是 140，两边都不知道对方存在。
 * 本守卫把判据从「登记表」扩到**扫描派生**：扫描集内的自述数字若不在登记站点、又不指向
 * 执行体，即红。这样"新增一处手抄"这件事本身可判，不依赖有人记得来登记。
 *
 * 判据（两条，全部**派生**）：
 *   ① 门禁条数 `\d+\s*项(静态)?守卫`：每一处的数字必须落在 `doc-numbers` 登记站点
 *      （DOC_NUMBER_SITES）的捕获组范围内 —— 值由那条守卫对账，本守卫只管"没登记"；
 *   ② 体量/行数上限 `(≤|<=|不超过)\s*\d+\s*行` / `\d+\s*行以内`：同行必须出现**执行点**
 *      （某个 `.mjs/.ts/.json/.sh` 文件或 `npm run …`——数字与它的执行体/指针句同现），
 *      否则就是一份不在册的副本（典型：约定旧版自称「≤ 80 行」而执行体表里是 140）。
 *
 * 扫描集 = doc-numbers 站点文件 ∪ doc-map 里 layer∈{宪法,契约} 且 active 的 .md ∪ 约定
 * （被体量表管理的根节点）。判据输入 = **索引**内容（`git show :<path>`，AGENTS §5.4）。
 *
 * 已知漏口（如实写）：认不得"八十行"这种中文数字写法；也不扫 .py/.ps1 里的注释。
 * 本守卫自身与其测试含模式字面量（定义处），显式豁免——豁免面只有这两个文件。
 *
 * 用法：node tools/v3-guard/doc-claim-numbers.mjs   （违例 exit 1）
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CONVENTION } from '../audit-kit/paths.mjs'
import { DOC_NUMBER_SITES } from './doc-numbers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DOC_MAP_REL = 'tools/v3-guard/lib/doc-map.json'
const SELF_EXEMPT = [
  'tools/v3-guard/doc-claim-numbers.mjs',
  'tools/v3-guard/__tests__/doc-claim-numbers.test.mjs',
]

/** 扫描层：与 doc-ref-check 同口径（治理文档，不含日志/标准库/待迁移） */
export const SCAN_LAYERS = ['宪法', '契约']
/**
 * 体量数字的「执行点」判据（同行出现即算有落点）：文件路径或 npm script。
 * 不写死某个具体文件——文档体量在 protocol-single-source 的体量表，代码体量在 structure-check
 * 的棘轮表……写死一处会把另一处变成假红（同族收全：认「有执行点」这个形态）。
 */
export const EXECUTOR_ON_LINE = /[\w./-]+\.(?:mjs|cjs|js|ts|json|sh)\b|npm run /
/** ① 门禁条数家族 */
export const GUARD_COUNT_RE = /(\d+)\s*项(?:静态)?守卫/g
/** ② 体量/行数上限家族 */
export const SIZE_CLAIM_RE = /(?:≤|<=|不超过)\s*(\d+)\s*行|(\d+)\s*行以内/g

export function scanPaths(docMap, conventionRel) {
  const set = new Set(DOC_NUMBER_SITES.map((s) => s.file))
  for (const d of docMap.docs)
    if (d.status === 'active' && SCAN_LAYERS.includes(d.layer) && /\.md$/.test(d.path))
      set.add(d.path)
  set.add(conventionRel)
  return [...set].filter((p) => !SELF_EXEMPT.includes(p)).sort()
}

/** 数字区间是否被某个登记站点的捕获组覆盖（值不在这里判——那是 doc-numbers 的活） */
export function coveredBySite(file, text, start, end, sites = DOC_NUMBER_SITES) {
  for (const site of sites) {
    if (site.file !== file) continue
    for (const sm of text.matchAll(new RegExp(site.re.source, 'g'))) {
      const gs = sm.index + sm[0].indexOf(sm[1])
      if (gs <= start && end <= gs + sm[1].length) return site
    }
  }
  return null
}

/**
 * 审计纯函数（注入以便喂红样）。
 * @param {Array<{path: string, text: string}>} files 扫描集（索引内容）
 * @param {{sites?: any[]}} [opts]
 * @returns {string[]} 问题列表（空 = 通过）
 */
export function auditClaimNumbers(files, { sites = DOC_NUMBER_SITES } = {}) {
  const problems = []
  for (const f of files) {
    if (SELF_EXEMPT.includes(f.path)) continue
    const at = (idx) => f.text.slice(0, idx).split(/\r?\n/).length
    const lineOf = (idx) => {
      const s = f.text.lastIndexOf('\n', idx) + 1
      const e = f.text.indexOf('\n', idx)
      return f.text.slice(s, e === -1 ? f.text.length : e)
    }
    // ① 门禁条数：数字必须落在某个登记站点的捕获组范围内（值由 doc-numbers 对账）
    for (const m of f.text.matchAll(new RegExp(GUARD_COUNT_RE.source, 'g'))) {
      const start = m.index + m[0].indexOf(m[1])
      const site = coveredBySite(f.path, f.text, start, start + m[1].length, sites)
      if (!site) {
        problems.push(
          `${f.path}:${at(m.index)} 手抄门禁条数「${m[0].trim()}」未登记：要么登记进 doc-numbers ` +
            `站点，要么改成指向 tools/v3-guard/run-all.mjs 的 GUARDS 派生句`
        )
      }
    }
    // ② 体量/行数上限：同行必须与执行体路径同现（指针句或历史引述）
    for (const m of f.text.matchAll(new RegExp(SIZE_CLAIM_RE.source, 'g'))) {
      if (EXECUTOR_ON_LINE.test(lineOf(m.index))) continue
      const num = m[1] || m[2]
      problems.push(
        `${f.path}:${at(m.index)} 手抄体量数字「${m[0].trim()}」（${num} 行）没有执行体：` +
          `删掉数字、改写成指向执行体（如 protocol-single-source.mjs 的体量表、` +
          `structure-check.mjs 的棘轮表）的指针句（数字只在执行体）`
      )
    }
  }
  return problems
}

function showFromIndex(rel) {
  return execFileSync('git', ['show', `:${rel}`], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

export function loadFiles() {
  const docMap = JSON.parse(showFromIndex(DOC_MAP_REL))
  const conventionRel = path.relative(ROOT, CONVENTION).replace(/\\/g, '/')
  const files = []
  for (const rel of scanPaths(docMap, conventionRel)) {
    try {
      files.push({ path: rel, text: showFromIndex(rel) })
    } catch {
      files.push({ path: rel, text: '\u0000MISSING-IN-INDEX' }) // 登记在册但索引里没有
      files.at(-1).missing = true
    }
  }
  return files
}

function main() {
  let files
  try {
    files = loadFiles()
  } catch (err) {
    console.error(`[doc-claim-numbers] 无法取证（git 不可用或 doc-map 读不到）：${err.message}`)
    process.exit(2)
  }
  const missing = files.filter((f) => f.missing).map((f) => f.path)
  const problems = auditClaimNumbers(files.filter((f) => !f.missing))
  for (const rel of missing)
    problems.push(`${rel} 登记在册但索引里没有（先让它被跟踪，或从 doc-map 摘掉）`)
  if (problems.length) {
    console.error('[doc-claim-numbers] 未通过：文档自述数字没有执行体')
    for (const p of problems) console.error('  ✗ ' + p)
    process.exit(1)
  }
  console.log(
    `[doc-claim-numbers] OK：${files.length} 份文档的自述数字全部可追溯到执行体` +
      `（门禁条数→doc-numbers 登记站点；体量→同行执行点）✓`
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
