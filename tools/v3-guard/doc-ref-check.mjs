#!/usr/bin/env node
/**
 * doc-ref-check — 跨文档引用必须可解析（1005 RC1 门禁之一）。
 *
 * 治什么：治理文档之间靠「代号 + 节号」互指（`K1 §B`、`C1 §6`、`约定 §4.1`、
 * `专项7 指标 3.2`）。节号被改名/重排/删除时，引用不会报错——读者顺着指针走到
 * 不存在的一节，或更糟：走到**编号还在但语义已换**的一节。1004 批标准库逐行复核里
 * 同一形态出现 3+ 份文档（专2 §0.2 跨专项引用、专3:33/1582、专5:2350），
 * 按 AGENTS §十「同一形态第 3 次出现 ⇒ 升格为门禁」立此守卫。
 *
 * 判据面（三条，全部**派生**，不硬编码清单）：
 *   ① 扫描集 = `doc-map.json` 里 layer ∈ {宪法, 契约} 且 active 的 .md 文档（含 AGENTS/MAP）；
 *   ② 目标集 = 同一份 doc-map 的 id→path 映射（C1…K4/MAP）+ `约定` 别名（标准库根节点）；
 *   ③ 指标号目标集 = 8 份专项 prose 的 `### 指标 x.y`（经 metrics-index 的解析器派生，
 *      不另写第二套解析：正文是指标清单的唯一权威源）。
 *
 * 判据输入 = **索引**（`git show :<path>` / `git ls-files`），不读工作树脏件（AGENTS §5.4）。
 *
 * 已知漏口（如实写）：只认这四种写法（`K1 §<字母>` / `<代号> §<数字>` / `专项N 指标 x.y` /
 * `专项N x.y/…`）；换一种记法（「K1 的 B 节」）本守卫认不出。它拦的是当前文书里真实使用的写法。
 *
 * 用法：node tools/v3-guard/doc-ref-check.mjs   （引用解析不了 ⇒ exit 1）
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CONVENTION } from '../audit-kit/paths.mjs'
import { parseSpecText } from '../audit-kit/metrics-index.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DOC_MAP_REL = 'tools/v3-guard/lib/doc-map.json'

/** 扫描层：只有这两层文档的引用进判据面（日志/标准库/待迁移是记录与外部域） */
export const SCAN_LAYERS = ['宪法', '契约']
/** 标准库根节点：被大量引用（`约定 §4`），但它是 external 域，不进扫描集、只当目标 */
export const CONVENTION_ALIAS = '约定'

const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/** `K1 §B` / `K1 §A/§C`（字母节） */
const REF_ALPHA = /K1\s*§\s*([A-Z])((?:\s*\/\s*§\s*[A-Z])*)/g
/** `<代号> §1` / `<代号> §4.1`（数字节；代号来自目标集） */
const REF_NUM = /(C1|C2|C3|K1|K2|K3|K4|MAP|约定)\s*§\s*(\d+(?:\.\d+)*)/g
/** `专项7 指标 3.2` / `专项8 3.4/3.8`（指标编号；标签「指标」可省） */
const REF_METRIC = /专项\s*([1-8])\s*(?:指标\s*)?(\d+\.\d+′?)((?:\s*\/\s*\d+\.\d+′?)*)/g

/** 标题 → 可被引用的节号集合（§N / N. / N、/ 中文序号 / 单个字母） */
export function headingNumbers(md) {
  const out = new Set()
  for (const line of md.split(/\r?\n/)) {
    const h = (line.match(/^#{2,4}\s+(.*)$/) || [])[1]
    if (!h) continue
    let m = h.match(/^§\s*(\d+(?:\.\d+)*)/)
    if (!m) m = h.match(/^(\d+(?:\.\d+)*)\s*[.、:：\s]/)
    if (!m) m = h.match(/^([一二三四五六七八九十]+)、/)
    if (m && CN_NUM[m[1]] !== undefined) {
      out.add(String(CN_NUM[m[1]]))
      continue
    }
    if (!m) m = h.match(/^([A-Z])[.、\s]/)
    if (m) out.add(m[1])
  }
  return out
}

/**
 * 审计纯函数（注入以便喂红样）。
 * @param {Array<{path: string, text: string}>} files 扫描集（索引内容）
 * @param {Map<string, {path: string, text: string}>} targets 代号 → 目标文档
 * @param {Map<string, Set<string>>} metricIds `专项N` → 文内编号集合（含 ′）
 * @returns {string[]} 问题列表（空 = 通过）
 */
export function auditRefs(files, targets, metricIds) {
  const problems = []
  const headings = new Map()
  for (const [code, t] of targets) headings.set(code, headingNumbers(t.text))
  for (const f of files) {
    const lines = f.text.split(/\r?\n/)
    lines.forEach((line, i) => {
      const at = (n) => `${f.path}:${i + 1} ${n}`
      for (const m of line.matchAll(REF_ALPHA)) {
        const extra = [...m[2].matchAll(/§\s*([A-Z])/g)].map((x) => x[1])
        for (const letter of [m[1], ...extra]) {
          if (!headings.get('K1')?.has(letter))
            problems.push(at(`K1 §${letter} 解析不了：K1 没有 §${letter} 节`))
        }
      }
      for (const m of line.matchAll(REF_NUM)) {
        const code = m[1] === CONVENTION_ALIAS ? CONVENTION_ALIAS : m[1]
        if (!targets.has(code)) {
          problems.push(at(`${code} 未登记目标文档（doc-map docs[] 里没有这个代号）`))
          continue
        }
        if (!headings.get(code)?.has(m[2]))
          problems.push(at(`${code} §${m[2]} 解析不了：${code} 没有 §${m[2]} 节`))
      }
      for (const m of line.matchAll(REF_METRIC)) {
        const spec = `专项${m[1]}`
        const nums = [m[2], ...[...m[3].matchAll(/\/\s*(\d+\.\d+′?)/g)].map((x) => x[1])]
        for (const num of nums) {
          const bare = num.replace(/′+$/, '′')
          if (!metricIds.get(spec)?.has(bare) && !metricIds.get(spec)?.has(bare.replace(/′$/, '')))
            problems.push(at(`${spec} ${num} 解析不了：${spec} 正文没有这个指标号`))
        }
      }
    })
  }
  return problems
}

/** 索引内容读取（判据输入受版本控制：staged/blob 内容，不读工作树） */
export function showFromIndex(rel) {
  return execFileSync('git', ['show', `:${rel}`], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

/** 从 doc-map 派生扫描集与目标集（不硬编码文档清单） */
export function loadPlan(docMap) {
  docMap = docMap || JSON.parse(showFromIndex(DOC_MAP_REL))
  const docs = docMap.docs.filter((d) => d.status === 'active' && /\.md$/.test(d.path))
  const scanned = docs.filter((d) => SCAN_LAYERS.includes(d.layer))
  const files = scanned.map((d) => ({ path: d.path, text: showFromIndex(d.path) }))
  const targets = new Map(
    docs.map((d) => [
      d.id,
      { path: d.path, text: files.find((f) => f.path === d.path)?.text ?? showFromIndex(d.path) },
    ])
  )
  targets.set(CONVENTION_ALIAS, {
    path: path.relative(ROOT, CONVENTION).replace(/\\/g, '/'),
    text: showFromIndex(path.relative(ROOT, CONVENTION).replace(/\\/g, '/')),
  })
  const metricIds = new Map()
  const specFiles = execFileSync('git', ['ls-files', '--', 'docs/根基文档/审查体系专项/专项*.md'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .sort()
  for (const rel of specFiles) {
    const spec = (path.basename(rel).match(/^专项(\d)/) || [])[1]
    if (!spec) continue
    const key = `专项${spec}`
    if (!metricIds.has(key)) metricIds.set(key, new Set())
    for (const e of parseSpecText(rel, spec, showFromIndex(rel))) metricIds.get(key).add(e.文内编号)
  }
  return { files, targets, metricIds }
}

function main() {
  let plan
  try {
    plan = loadPlan()
  } catch (err) {
    console.error(`[doc-ref-check] 无法取证（git 不可用或 doc-map 读不到）：${err.message}`)
    process.exit(2)
  }
  const problems = auditRefs(plan.files, plan.targets, plan.metricIds)
  if (problems.length) {
    console.error('[doc-ref-check] 未通过：跨文档引用解析不了')
    for (const p of problems) console.error('  ✗ ' + p)
    console.error(
      '处理：改引用（指向真实节号）或改目标文档（补回被引节）；两处都改不动 ⇒ 停下来问用户。'
    )
    process.exit(1)
  }
  console.log(
    `[doc-ref-check] OK：${plan.files.length} 份受控文档的跨文档引用全部可解析` +
      `（目标 ${plan.targets.size} 个代号 / ${[...plan.metricIds.values()].reduce((n, s) => n + s.size, 0)} 个指标号）✓`
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
