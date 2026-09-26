#!/usr/bin/env node
/**
 * dispatch — 把 396 指标切成 N 个可并发执行的审查窗，并生成各窗 brief。
 *
 * 治的是这一件事：开窗成本全靠人肉（手写 brief + 手抄覆盖清单），
 * 于是每轮重新发明一次切法，覆盖面与口径必然漂移。
 *
 * 切法单位 = 「专项 × 部分」（约定.md §4 规则④：禁止把单个部分再拆）。
 * 规则本身不在这里复述——brief 只装数据（ID 闭集 / 落点 / 必读行），规则一律指向 约定.md §4。
 *
 * 用法：
 *   node tools/audit-kit/dispatch.mjs --windows 6 --batch 926 [--only 专项1,专项5] [--out <目录>] [--dry]
 *   默认输出到 <审件库>/<batch>/，只写不存在的文件；--dry 只打印切分账。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseSpec, summarize } from './metrics-index.mjs'
import { ROOT, CONVENTION, AUDITS_DIR } from './paths.mjs'

const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/**
 * 成本常数（分钟）。首版估值，非实测——每窗交件后由 scorecard 用实际耗回填。
 * 之所以仍要一个数：没有成本模型就没法把「切 6 窗各多久」在开工前答出来。
 */
export const COST = { 每指标: 1.2, 每千行: 8, 固定: 5 }

/** 约定.md §4 的「专项 → 必读设计章节」表（唯一口径源，此处只读不复述） */
export function parseRequiredReading(md = readFileSync(CONVENTION, 'utf8')) {
  const map = new Map()
  for (const l of md.split(/\r?\n/)) {
    const m = l.match(/^\|\s*专项(\d)[^|]*\|\s*(.+?)\s*\|\s*$/)
    if (m) map.set(`专项${m[1]}`, m[2].trim())
  }
  return map
}

/** 单份专项文件里「第X部分」的行区间（用于按正文行数估成本） */
export function partSpans(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  const marks = []
  lines.forEach((l, i) => {
    const m = l.match(/^##\s+第([一二三四五六七八九十]+)部分\s*[:：]?\s*(.*)$/)
    if (m) marks.push({ part: CN[m[1]] ?? 0, line: i, title: m[2].trim() })
    else if (/^##\s+附录/.test(l)) marks.push({ part: 0, line: i, title: '附录区' })
  })
  const spans = new Map()
  marks.forEach((mk, i) => {
    if (!mk.part) return
    const end = i + 1 < marks.length ? marks[i + 1].line - 1 : lines.length
    if (!spans.has(mk.part))
      spans.set(mk.part, { start: mk.line, end, 行数: end - mk.line + 1, 标题: mk.title })
  })
  return spans
}

/** 指标条目 → 「专项 × 部分」切片（切窗的原子单位） */
export function buildSlices(entries = parseSpec()) {
  const bySpecFile = new Map()
  const spansCache = new Map()
  for (const e of entries) {
    if (!e.部分) continue
    const key = `${e.专项}-${e.部分}`
    if (!bySpecFile.has(key)) {
      bySpecFile.set(key, {
        key,
        专项: e.专项,
        部分: e.部分,
        专项文件: e.专项文件,
        标题: e.部分标题,
        指标: [],
        面: new Set(),
      })
    }
    const s = bySpecFile.get(key)
    s.指标.push(e)
    for (const p of e.面.paths) s.面.add(p)
  }
  const unassigned = entries.filter((e) => !e.部分)
  const slices = []
  for (const s of bySpecFile.values()) {
    if (!spansCache.has(s.专项文件)) {
      let spans = new Map()
      try {
        spans = partSpans(path.join(ROOT, s.专项文件))
      } catch {
        spans = new Map() // 注入用例/缺文件：无正文行数可算，只按指标数计成本
      }
      spansCache.set(s.专项文件, spans)
    }
    const span = spansCache.get(s.专项文件).get(s.部分)
    s.面 = [...s.面].sort()
    s.行数 = span?.行数 || 0
    s.可机判数 = s.指标.filter((m) => m.可执行性 === 'auto-candidate').length
    s.成本 = +(s.指标.length * COST.每指标 + (s.行数 / 1000) * COST.每千行 + COST.固定).toFixed(1)
    slices.push(s)
  }
  slices.sort((a, b) => a.专项.localeCompare(b.专项) || a.部分 - b.部分)
  return { slices, unassigned }
}

/** 同专项相邻部分证据面重叠 >50% ⇒ 合并候选（Jaccard；不自动合，交人确认——同 §4.1 精神） */
export function overlapProposals(slices, threshold = 0.5) {
  const out = []
  const bySpec = new Map()
  for (const s of slices) (bySpec.get(s.专项) || bySpec.set(s.专项, []).get(s.专项)).push(s)
  for (const list of bySpec.values()) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = new Set(list[i].面)
        const b = new Set(list[j].面)
        if (!a.size || !b.size) continue
        const inter = [...a].filter((x) => b.has(x)).length
        const union = new Set([...a, ...b]).size
        const jac = inter / union
        if (jac > threshold)
          out.push({
            专项: list[i].专项,
            对: `${list[i].key} + ${list[j].key}`,
            重叠率: +(jac * 100).toFixed(1),
            共有面: [...a].filter((x) => b.has(x)),
          })
      }
  }
  return out.sort((x, y) => y.重叠率 - x.重叠率)
}

/**
 * 装箱：先按「整专项」投递（约定.md §4：8 专项互相独立、零执行依赖 ⇒ 默认 1 专项 = 1 窗），
 * 窗数多于专项数时，才把最重的窗按切片劈给空窗，直到失衡比 ≤1.35 或无可劈。
 * 窗数少于专项数时不劈专项（宁可失衡，也不让同一专项的判断散到两窗）。
 */
export function partition(slices, windows) {
  const groups = new Map()
  for (const s of slices) (groups.get(s.专项) || groups.set(s.专项, []).get(s.专项)).push(s)
  const items = [...groups.entries()].map(([z, ss]) => ({ 专项: z, slices: ss }))
  const bins = Array.from({ length: windows }, (_, i) => ({
    id: `W${i + 1}`,
    slices: [],
    成本: 0,
    专项: new Set(),
  }))
  const lightest = (list) => list.reduce((x, y) => (x.成本 <= y.成本 ? x : y))
  const put = (bin, s) => {
    bin.slices.push(s)
    bin.专项.add(s.专项)
    bin.成本 = +(bin.成本 + s.成本).toFixed(1)
  }

  for (const it of [...items].sort(
    (a, b) => b.slices.reduce((n, s) => n + s.成本, 0) - a.slices.reduce((n, s) => n + s.成本, 0)
  )) {
    const bin = lightest(bins)
    for (const s of it.slices) put(bin, s)
  }

  if (windows > items.length) {
    for (let guard = 0; guard < 200; guard++) {
      const heavy = bins.reduce((x, y) => (x.成本 >= y.成本 ? x : y))
      const poor = lightest(bins)
      if (heavy === poor || heavy.成本 / Math.max(poor.成本, 0.1) <= 1.35) break
      const same = (b, z) => b.slices.filter((s) => s.专项 === z).length
      const movable = heavy.slices
        .filter((s) => same(heavy, s.专项) > 1)
        .sort((a, b) => b.成本 - a.成本)
      const pick = movable[0]
      if (!pick) break
      heavy.slices.splice(heavy.slices.indexOf(pick), 1)
      heavy.成本 = +(heavy.成本 - pick.成本).toFixed(1)
      if (!same(heavy, pick.专项)) heavy.专项.delete(pick.专项)
      put(poor, pick)
    }
  }
  for (const b of bins) b.slices.sort((x, y) => x.专项.localeCompare(y.专项) || x.部分 - y.部分)
  return bins
}

function headSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()
  } catch {
    return 'unknown'
  }
}

/** 生成期实测一条命令的 stdout，用作 §0 的期望值；起不来就不写这条（不留假期望） */
function capture(cmd) {
  try {
    return execFileSync('bash', ['-c', cmd], { cwd: ROOT, encoding: 'utf8', timeout: 30000 }).trim()
  } catch {
    return null
  }
}

const SIX = [
  '§1 覆盖率',
  '§1b 未覆盖/未证清单',
  '§2 问题册（只收 P0/P1/P2）',
  '§3 钩子清单',
  '§4 对上游结论的复核',
  '§5 存量一行 + 待裁（≤3）',
  '§6 卫生与自查',
]

/** 生成一窗 brief（Markdown）。规则不复述，全部指向 约定.md §4 / AGENTS.md §十一。 */
export function renderBrief(win, ctx) {
  const ids = win.slices.flatMap((s) => s.指标.map((m) => m.id))
  const specFiles = [...new Set(win.slices.map((s) => s.专项文件))]
  const 必读 = [...new Set(win.slices.map((s) => s.专项))]
    .map(
      (z) =>
        `- ${z}：${ctx.必读.get(z) || '（约定.md §4 表内无此行 ⇒ 须先补 约定.md，不得就地自拟）'}`
    )
    .join('\n')
  const 附录 = specFiles.map((f) => `- ${f} 的「## 附录」区（答案册，读了会锚定结论）`).join('\n')

  const 落点 = (m) => {
    const all = [...m.面.paths, ...m.面.patterns.map((p) => `${p}＊`)]
    return all.length
      ? all.join(' ')
      : '（本条未写可核落点 ⇒ 覆盖账只能靠窗口自报，须补进专项文档）'
  }
  const 表 = win.slices
    .flatMap((s) => s.指标)
    .map(
      (m) =>
        `| ${m.id} | ${m.名称} | ${m.风险等级 || '-'} | ${m.可执行性} | ${落点(m)}${m.面.missing.length ? ` ｜⚠断链:${m.面.missing.join(' ')}` : ''} | ${m.专项文件}:${m.行号} |`
    )
    .join('\n')

  const grepCmd = `grep -c '^### 指标 ' ${specFiles.join(' ')}`
  const grepOut = capture(grepCmd)
  const checkOut = capture('node tools/audit-kit/metrics-index.mjs --check | tail -1')
  const 核对 = [
    ['git rev-parse --short HEAD', ctx.head],
    ...(checkOut ? [['node tools/audit-kit/metrics-index.mjs --check | tail -1', checkOut]] : []),
    ...(grepOut ? [[grepCmd, grepOut]] : []),
  ]
    .map(([c, e]) => `${c}\n# 期望: ${e}`)
    .join('\n')

  return `# ${ctx.batch} 审查窗 ${win.id}（生成件，勿手改数据列）

> 生成命令：\`node tools/audit-kit/dispatch.mjs --windows ${ctx.windows} --batch ${ctx.batch}\`
> 生成时点 HEAD：\`${ctx.head}\`；生成器版本随 commit 走，改切法请改生成器，不要改本文件。
> **规则只有一处**：\`docs/根基文档/审查体系专项/审查体系约定.md\` §4（切窗/附录隔离/产出命名）与 \`AGENTS.md\` §十一（六节交付）。本 brief 只装数据。

## §0 五分钟核对（整块可复跑，交件前不许改命令、只许补自己的实测块）

\`\`\`bash
${核对}
\`\`\`

## 本窗负责的指标（闭集 ${ids.length} 条；超出即越界，缺一条即漏检）

| ID | 名称 | 等级 | 可执行性 | 落点（＊=模式，须窗口自行展开） | 标准库出处 |
| --- | --- | --- | --- | --- | --- |
${表}

切片账：${win.slices.map((s) => `${s.key}(${s.标题}) ${s.指标.length} 条/${s.行数} 行/${s.成本}min`).join('　')}

**预估本窗成本 ≈ ${win.成本} 分钟**（常数 ${JSON.stringify(COST)} 为首版估值，交件后由记分卡回填真值）。

## 必读设计章节（约定.md §4 表内行，逐字取用）

${必读}

## 禁读清单（附录隔离，防锚定）

${附录}
- 其他窗的 brief 与问题副本（交叉只在汇总层发生）

${SIX.map((h) => `## ${h}\n\n（按 AGENTS.md §十一 的硬要求填；本节不得空交）\n`).join('\n')}
## 认领登记

- 窗口：${win.id}　认领人：____　开工：____　交件：____
- 发现编号前缀固定 \`${win.id}-\`（跨窗命名空间不相交，合并时不撞号）
`
}

export function renderLedger(bins, ctx) {
  const lines = bins.map(
    (b) =>
      `| ${b.id} | ${b.slices.map((s) => s.key).join(' ')} | ${b.slices.reduce((n, s) => n + s.指标.length, 0)} | ${b.slices.reduce((n, s) => n + s.行数, 0)} | ${b.成本} |`
  )
  return `# ${ctx.batch} 派单账（生成件）

- HEAD \`${ctx.head}\`｜窗数 ${ctx.windows}｜指标合计 ${ctx.统计.指标数}｜失衡比 ${ctx.失衡比}x
- 未归部条目（无「## 第X部分」标题 ⇒ 不进切窗，须回专项文档补层级）：${ctx.未归部 || 0} 条
- 证据面重叠候选（Jaccard>50%，同 约定.md §4 规则② ⇒ 人裁是否并窗，生成器不自动合）：${ctx.重叠.length} 对

| 窗 | 切片 | 指标数 | 正文行 | 预估分钟 |
| --- | --- | --- | --- | --- |
${lines.join('\n')}

## 重叠候选明细

${ctx.重叠.length ? ctx.重叠.map((o) => `- ${o.对}：重叠 ${o.重叠率}%（共有 ${o.共有面.length} 个落点）`).join('\n') : '（无可算重叠：多数指标未写明可核落点）'}

## 判据可机器执行率（这批有多少判据真能跑，不是「写了命令」）

- auto-candidate ${ctx.统计.可执行性['auto-candidate']}／static ${ctx.统计.可执行性.static}／manual ${ctx.统计.可执行性.manual}（合计 ${ctx.统计.指标数}）
- 落点账：实测存在 ${ctx.统计.有证据面数}｜只有模式 ${ctx.统计.只有模式面数}｜**完全无落点 ${ctx.统计.无落点数}**（这三数之和 = 指标数；无落点的条目覆盖率只能靠窗口自报，是漏检的结构性来源）
`
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const arg = (name, dflt) =>
    argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : dflt
  const windows = Number(arg('windows', 8))
  const batch = arg('batch', null)
  const dry = argv.includes('--dry')
  const only = arg('only', '')
    .split(',')
    .filter(Boolean)
    .map((s) => s.replace(/^专/, '专项'))

  const entries = parseSpec()
  let use = only.length ? entries.filter((e) => only.includes(e.专项)) : entries
  const { slices, unassigned } = buildSlices(use)
  if (!slices.length) {
    console.error('没有可切的切片（--only 写错？）')
    process.exit(2)
  }
  const bins = partition(slices, windows)
  const 成本列 = bins.map((b) => b.成本)
  const ctx = {
    batch: batch || `${new Date().toISOString().slice(5, 10).replace('-', '')}`,
    head: headSha(),
    windows,
    必读: parseRequiredReading(),
    统计: summarize(use),
    未归部: unassigned.length,
    重叠: overlapProposals(slices),
    失衡比: (Math.max(...成本列) / Math.min(...成本列)).toFixed(2),
  }

  console.log(`[dispatch] ${ctx.batch}｜${windows} 窗｜${use.length} 指标｜失衡比 ${ctx.失衡比}x`)
  for (const b of bins)
    console.log(
      `  ${b.id}: ${b.slices.length} 切片 ${b.slices.reduce((n, s) => n + s.指标.length, 0)} 指标 ${b.成本}min ← ${b.slices.map((s) => s.key).join(',')}`
    )
  if (ctx.重叠.length) console.log(`  重叠候选 ${ctx.重叠.length} 对（详见派单账）`)
  if (unassigned.length)
    console.log(`  ⚠ 未归部 ${unassigned.length} 条：${unassigned.map((e) => e.id).join(' ')}`)

  if (dry) process.exit(0)
  const outDir = path.resolve(arg('out', path.join(AUDITS_DIR, ctx.batch)))
  mkdirSync(outDir, { recursive: true })
  const written = []
  for (const b of bins) {
    const f = path.join(outDir, `${b.id}.md`)
    if (existsSync(f) && !argv.includes('--force')) {
      console.log(`  跳过已存在 ${path.relative(ROOT, f)}（--force 覆盖）`)
      continue
    }
    writeFileSync(f, renderBrief(b, ctx))
    written.push(b.id)
  }
  writeFileSync(path.join(outDir, '00-派单账.md'), renderLedger(bins, ctx))
  writeFileSync(
    path.join(outDir, 'claims.json'),
    JSON.stringify(
      {
        批次: ctx.batch,
        head: ctx.head,
        审件库: path.relative(ROOT, AUDITS_DIR),
        窗: bins.map((b) => ({
          id: b.id,
          切片: b.slices.map((s) => s.key),
          指标: b.slices.flatMap((s) => s.指标.map((m) => m.id)),
          预估分钟: b.成本,
        })),
      },
      null,
      1
    )
  )
  console.log(
    `  已写 ${written.length} 份 brief + 派单账 + claims.json → ${path.relative(ROOT, outDir)}`
  )
}
