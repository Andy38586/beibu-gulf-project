#!/usr/bin/env node
/**
 * metrics-index — 把 8 份专项标准库（指标清单的唯一权威源）抽成机器可读索引。
 *
 * 权威源是专项 prose，本脚本的产物是**生成即焚**的中间物：落在 .local/metrics-index/<HEAD短sha>.json，
 * 不入库、随时可重算。入库会造出第二份指标副本（AGENTS §七-7），HEAD 入文件名则换 sha 即自动失效。
 *
 * 用法：
 *   node tools/audit-kit/metrics-index.mjs                 # 生成 + 打印摘要
 *   node tools/audit-kit/metrics-index.mjs --check         # 体系自检：撞号/缺字段/证据面腐烂（有违例 exit 1）
 *   node tools/audit-kit/metrics-index.mjs --reconcile     # 与附录 §8 逐条对账（有差异 exit 1）
 *   node tools/audit-kit/metrics-index.mjs --dump <path>   # 另存 JSON
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { APPENDIX, parseDetailRows } from '../v3-guard/lib/appendix-rows.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SPEC_DIR = path.join(ROOT, 'docs/根基文档/审查体系专项')

/** 约定.md §2 的 11 字段，顺序即书写顺序 */
export const FIELDS = [
  '指标名称',
  '检查目标',
  '为什么需要检查',
  '检查范围',
  '检查方法',
  '需要查看',
  '正常标准',
  '异常情况',
  '风险等级',
  '整改方向',
  '验收标准',
]

const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const FIELD_RE =
  /^(\s*)\*\*(指标名称|检查目标|为什么需要检查|检查范围|检查方法|需要查看|正常标准|异常情况|风险等级|整改方向|验收标准)\*\*\s*[:：]\s*(.*)$/
const METRIC_RE = /^###\s+指标\s+(\d+)\.(\d+)(′*)\s*[:：]\s*(.*)$/
const PART_RE = /^##\s+第([一二三四五六七八九十]+)部分\s*[:：]?\s*(.*)$/
const APPENDIX_RE = /^##\s+附录/
const LEVEL_RE = /^(P[0-3])/

/** 看起来像仓库内路径的 token：以顶层目录名开头，且不夹在更长路径/词的中间（`feat/fix/docs/chore` 不算） */
const PATH_TOKEN_RE =
  /(?<![\w/.-])(?:frontend|backend|tools|scripts|docs|deploy|node_modules|src|public|certs|\.github|\.husky)[\w\-./]*/g

function specFiles() {
  return readdirSync(SPEC_DIR)
    .filter((f) => /^专项[1-8]-.*\.md$/.test(f))
    .sort()
    .map((f) => path.join(SPEC_DIR, f))
}

function headLine(line) {
  if (/^```/.test(line)) return 'fence'
  if (APPENDIX_RE.test(line)) return 'appendix'
  const part = line.match(PART_RE)
  if (part) return { part: CN_NUM[part[1]] ?? 0, partTitle: part[2].trim() }
  const metric = line.match(METRIC_RE)
  if (metric) return { metric: `${metric[1]}.${metric[2]}${metric[3]}`, title: metric[4].trim() }
  return null
}

/** 从「检查范围/需要查看/检查方法」里抽证据面：路径实测存在性，glob 原样保留待窗展开 */
export function collectSurface(entry, root = ROOT) {
  const text = [entry.检查范围, entry.需要查看, entry.检查方法].join('\n')
  const tokens = new Set()
  for (const m of text.matchAll(PATH_TOKEN_RE)) {
    const t = m[0].replace(/[.,;:)]+$/, '')
    if (t.length > 6) tokens.add(t)
  }
  const paths = []
  const patterns = []
  const missing = []
  for (const t of tokens) {
    if (t.includes('*')) {
      patterns.push(t)
      continue
    }
    const abs = path.join(root, t)
    if (existsSync(abs)) paths.push(t)
    else if (!/\.[a-z]{2,5}$/i.test(t) || existsSync(path.dirname(abs))) missing.push(t)
  }
  return { paths: paths.sort(), patterns: patterns.sort(), missing: missing.sort() }
}

/** 判据能不能机器跑：检查方法里有没有真命令（命令常被反引号裹住，先剥掉再判） */
function judgeExecutable(entry) {
  const text = (entry.检查方法 || '').replace(/`/g, '')
  if (
    /```[\s\S]*?```/.test(entry.检查方法 || '') ||
    /(^|\s)(npm run|npx |node |grep |rg |find |git |wc -|stylelint|eslint|dependency-cruiser|curl )/m.test(
      text
    )
  ) {
    return 'auto-candidate'
  }
  return entry.面?.paths?.length || entry.面?.patterns?.length ? 'static' : 'manual'
}

/**
 * 单份专项 prose → 指标条目。markdown 可注入 —— 否则红样喂不进来（变异四式起不来）。
 * rel 仅作为条目的来源标注，不读盘。
 */
export function parseSpecText(rel, 专项, markdown) {
  const entries = []
  const lines = markdown.split(/\r?\n/)
  let part = 0
  let partTitle = ''
  let inAppendix = false
  let cur = null
  let fieldName = null
  let buf = []
  let fence = false

  const flush = () => {
    if (cur && fieldName) {
      const prev = cur.fields[fieldName]
      const next = buf.join('\n').trim()
      cur.fields[fieldName] = prev ? `${prev}\n${next}` : next
    }
    buf = []
    fieldName = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^```/.test(line)) fence = !fence
    if (!fence) {
      const h = headLine(line)
      if (h === 'appendix') {
        flush()
        inAppendix = true
        cur = null
        continue
      }
      if (h && typeof h === 'object' && h.part) {
        flush()
        part = h.part
        partTitle = h.partTitle
        cur = null
        inAppendix = false
        continue
      }
      if (h && typeof h === 'object' && h.metric) {
        flush()
        cur = {
          id: `专${专项}-${h.metric}`,
          专项: `专项${专项}`,
          专项文件: rel,
          部分: part,
          部分标题: partTitle,
          文内编号: h.metric,
          名称: h.title,
          fields: {},
          行号: i + 1,
          落在附录区: inAppendix,
        }
        entries.push(cur)
        continue
      }
    }
    if (!cur) continue
    const f = !fence ? line.match(FIELD_RE) : null
    if (f) {
      flush()
      fieldName = f[2]
      buf = [f[3]]
      continue
    }
    if (fieldName && !/^#{2,4}\s/.test(line)) buf.push(line.replace(/^\s{1,6}/, ''))
  }
  flush()

  for (const e of entries) {
    for (const fld of FIELDS) e[fld] = (e.fields[fld] || '').trim()
    delete e.fields
    e.风险等级 = (e.风险等级 || '').match(LEVEL_RE)?.[1] || ''
    e.缺失字段 = FIELDS.filter((fld) => (fld === '指标名称' ? !e.名称 && !e.指标名称 : !e[fld]))
    e.面 = collectSurface(e, ROOT)
    e.可执行性 = judgeExecutable(e)
    e.附录隔离 = /附录|判例/.test(e.部分标题) || e.落在附录区
  }
  return entries
}

/** 读真实 8 份专项 prose（权威源） */
export function parseSpec(files = specFiles()) {
  const entries = []
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    const 专项 = (path.basename(file).match(/^专项(\d)/) || [])[1]
    entries.push(...parseSpecText(rel, 专项, readFileSync(file, 'utf8')))
  }
  return entries
}

/**
 * 各专项指标数（专项 → 条数）。
 * 这是「指标清单」的**权威源导出**：专项 prose 是唯一事实源，
 * 约定 §3 / 附录 §8 / metrics-tally / metrics:derive 一律与此对账，不得各抄一份数。
 */
export function countBySpec(entries = parseSpec()) {
  const out = {}
  for (const e of entries) out[e.专项] = (out[e.专项] || 0) + 1
  return out
}

/** 体系自检：撞号 / 缺字段 / 证据面断链 / 指标落在附录区 */
export function checkIndex(entries) {
  const problems = []
  const seen = new Map()
  for (const e of entries) {
    seen.set(e.id, (seen.get(e.id) || 0) + 1)
  }
  for (const [id, n] of [...seen].sort()) {
    if (n > 1) problems.push(`ID 撞号：${id} 出现 ${n} 次（同专项内「部分.序号」必须唯一）`)
  }
  const noField = entries.filter((e) => e.缺失字段.length)
  for (const e of noField) problems.push(`字段缺失：${e.id} 缺 ${e.缺失字段.join('/')}`)
  const broken = entries.filter((e) => e.面.missing.length)
  for (const e of broken)
    problems.push(`证据面断链：${e.id} 引用不存在的路径 ${e.面.missing.join(', ')}`)
  const misplaced = entries.filter((e) => e.落在附录区)
  for (const e of misplaced)
    problems.push(`指标落在附录区内：${e.id}（附录是答案册，须与正文分开）`)
  const noLevel = entries.filter((e) => !e.风险等级)
  for (const e of noLevel) problems.push(`无 P0-P3 等级：${e.id}`)
  return { problems, 统计: summarize(entries) }
}

export function summarize(entries) {
  const byExec = { 'auto-candidate': 0, static: 0, manual: 0 }
  const withSurface = entries.filter((e) => e.面.paths.length).length
  const onlyPattern = entries.filter((e) => !e.面.paths.length && e.面.patterns.length).length
  for (const e of entries) byExec[e.可执行性]++
  return {
    指标数: entries.length,
    撞号数: entries.length - new Set(entries.map((e) => e.id)).size,
    缺字段数: entries.filter((e) => e.缺失字段.length).length,
    断链指标数: entries.filter((e) => e.面.missing.length).length,
    有证据面数: withSurface,
    只有模式面数: onlyPattern,
    无落点数: entries.length - withSurface - onlyPattern,
    可执行性: byExec,
  }
}

/** 与附录 §8 明细表逐条对账（附录侧正则复用 lib/appendix-rows，避免两种口径；markdown 可注入以便喂红样） */
export function reconcile(entries, appendixMarkdown = readFileSync(APPENDIX, 'utf8')) {
  const rows = parseDetailRows(appendixMarkdown)
  const problems = []
  const norm = (s) => s.replace(/′/g, '').trim()
  for (const [专项, list] of rows) {
    const mine = entries.filter((e) => e.专项 === 专项)
    const a = new Map(list.map((r) => [norm(r.id), r]))
    const b = new Map(mine.map((e) => [norm(e.文内编号), e]))
    for (const id of [...a.keys()].sort()) {
      if (!b.has(id)) problems.push(`${专项} ${id}：附录有、正文无`)
      else if (a.get(id).level !== b.get(id).风险等级)
        problems.push(
          `${专项} ${id}：等级不一致 附录=${a.get(id).level} 正文=${b.get(id).风险等级}`
        )
      // F-02（2026-10-05）：名称列此前无任何执行体（改附录名称三闸全绿）。
      // 附录:4 自述「编号/名称/风险等级三列无损提取」⇒ 对账面必须真覆盖三列。
      else if (norm(a.get(id).name) !== norm(b.get(id).名称))
        problems.push(`${专项} ${id}：名称不一致 附录=${a.get(id).name} 正文=${b.get(id).名称}`)
    }
    for (const id of [...b.keys()].sort())
      if (!a.has(id)) problems.push(`${专项} ${id}：正文有、附录无`)
  }
  const totalAppendix = [...rows.values()].reduce((n, l) => n + l.length, 0)
  if (totalAppendix !== entries.length)
    problems.push(`总数不一致：附录 ${totalAppendix} 正文 ${entries.length}`)
  const states = new Map()
  for (const list of rows.values())
    for (const r of list) states.set(r.state, (states.get(r.state) || 0) + 1)
  return { problems, 附录状态分布: Object.fromEntries([...states].sort()) }
}

function headSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()
  } catch {
    return 'no-git'
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const entries = parseSpec()
  const outDir = path.join(ROOT, '.local/metrics-index')
  mkdirSync(outDir, { recursive: true })
  const out = path.join(outDir, `${headSha()}.json`)
  writeFileSync(out, JSON.stringify(entries, null, 1))

  const s = summarize(entries)
  console.log(`[metrics-index] ${s.指标数} 条指标 → ${path.relative(ROOT, out)}`)
  console.log(
    `  撞号 ${s.撞号数}｜缺字段 ${s.缺字段数}｜证据面断链 ${s.断链指标数}｜有可核面 ${s.有证据面数}`
  )
  console.log(
    `  可执行性 auto-candidate ${s.可执行性['auto-candidate']}｜static ${s.可执行性.static}｜manual ${s.可执行性.manual}`
  )

  let code = 0
  if (argv.includes('--dump')) {
    const to = argv[argv.indexOf('--dump') + 1]
    if (!to) {
      console.error('--dump 需要一个路径')
      process.exit(2)
    }
    mkdirSync(path.dirname(path.resolve(to)), { recursive: true })
    writeFileSync(to, JSON.stringify(entries, null, 1))
    console.log(`已另存 ${to}`)
  }
  if (argv.includes('--check')) {
    const { problems } = checkIndex(entries)
    if (!problems.length) console.log('[metrics-index] --check 通过')
    else {
      console.log(`[metrics-index] --check ${problems.length} 处违例：`)
      for (const p of problems.slice(0, 40)) console.log('  - ' + p)
      if (problems.length > 40) console.log(`  …（另 ${problems.length - 40} 条，见 --json）`)
      code = 1
    }
  }
  if (argv.includes('--reconcile')) {
    const r = reconcile(entries)
    console.log(`[metrics-index] 附录状态分布 ${JSON.stringify(r.附录状态分布)}`)
    if (!r.problems.length) console.log('[metrics-index] --reconcile 正文与附录全等')
    else {
      console.log(`[metrics-index] --reconcile ${r.problems.length} 处差异：`)
      for (const p of r.problems.slice(0, 40)) console.log('  - ' + p)
      code = 1
    }
  }
  process.exit(code)
}
