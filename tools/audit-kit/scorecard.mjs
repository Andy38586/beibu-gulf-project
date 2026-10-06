#!/usr/bin/env node
/**
 * scorecard — 把审查体系的五个「质量数」从产物里算出来，不再由窗口手填。
 *
 * 为什么要有它：AGENTS.md §十一 定了绝对锚点 ≥60 / 锚点真实率 ≥93% / 可复跑判据 ≥20，
 * §十二 定了膨胀率与归属四态，§十 定了 RC1–RC4 —— 这五个数此前**全仓没有一个计算体**，
 * 数值靠各批监督日志手抄（922/925 均是）。手抄的数只能自证，不能证伪。
 *
 * 输入：一个批次目录（含各窗交付件；有 claims.json 时才算覆盖率）。
 * 判红口径：任一门槛未达标 ⇒ exit 1（这是**人手动敲的工具**，不挂 hook、不进 CI）。
 *
 * 1004-QC-03/06/07 收口（口径与实现对齐）：
 *   - 锚点真实率 = 机械定位成功子集上「行界内 **且目标行非空白**」的比例（旧实现只查行号界内）；
 *   - 可复跑判据只数 **§0 章节**内带 `# 期望:` 的命令（旧实现把 §3 钩子清单也数进去）；
 *   - 条目识别三形态（`P0-…` 前缀 / `### …（P1）…` / `### …｜**P1**｜…`）；
 *   - 归属标签两形态（反引号 `` `引入` `` 与 `归属：**引入**`）都计入；
 *   - 窗件发现：全部非 README/00-记分卡 的 .md 都纳入（混合命名批次不再只认 W*.md）。
 *
 * 用法：node tools/audit-kit/scorecard.mjs <批次目录> [--out 00-记分卡.md] [--json]
 *      [--strict]  --strict：把「未取证」也判为失败（批末门禁用——claims.json 是交件必填，
 *                  缺它就等于覆盖率没有输入，不许以 exit 0 混过）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { extractBashBlocks } from './extract-window.mjs'
import { ROOT } from './paths.mjs'

/** 门槛唯一定义处；文档要引用就引这里，不得另抄一份数 */
export const THRESHOLD = { 绝对锚点: 60, 锚点真实率: 0.93, 可复跑判据: 20 }

/**
 * 锚点 = 「路径:行号」。量尺两处坑必须避开：
 *  - \w 不认中文，`专项1-数据链审查-执行记录.md:47` 会被截成 `.md:47` ⇒ 用 \p{L}；
 *  - 光文件名不带 `/` 的（README.md:47）也要能解析 ⇒ 解析时按 ROOT/批次目录/件所在目录三试。
 */
const ANCHOR_RE =
  /([\p{L}\p{N}][\p{L}\p{N}._/-]*\.(?:ts|js|mjs|cjs|vue|css|scss|py|sql|json|md|yml|yaml|sh|html))[:：](\d+)/gu
const VERDICT_RE = /(P[0-3]|属实|不属实|通过|证伪|豁免|未证|不适用|降级|已修|未修|半修)/
const RC_RE = /\bRC([1-4])\b/g
const TAG_TOKEN = '(引入|收口不足|取证漏|流程)'
const TAG_BACKTICK_RE = new RegExp('`' + TAG_TOKEN + '`', 'gu')
const TAG_ATTRIB_RE = new RegExp('归属\\s*[:：]\\s*[*`【]*\\s*' + TAG_TOKEN, 'u')
/** 条目行三形态：`P0-…` 前缀 / `### …（P1）…` / `### …｜**P1**｜…`（1004-QC-03/07） */
const ENTRY_RES = [
  /^\s*[|>\-*]?\s*\**P[0-3]\b/,
  /^#{1,6}\s+.*?（P[0-3]）/, // 全角括号形态：### F1（P0）…
  /^#{1,6}\s+.*?[｜|·]\s*\**P[0-3]\**\s*(?:[｜|·]|$)/, // 分隔符形态：### G1：…｜**P1**｜…
]
const isEntryLine = (l) => ENTRY_RES.some((re) => re.test(l))

const linesCache = new Map()
function linesOf(abs) {
  if (!linesCache.has(abs)) linesCache.set(abs, readFileSync(abs, 'utf8').split(/\r?\n/))
  return linesCache.get(abs)
}
function fileLines(abs) {
  return linesOf(abs).length
}

/** tracked 文件索引：basename → [相对路径]。git 不可用 ⇒ null（相关判据记未取证，不判红不判绿） */
let _index = null
function baseIndex(root) {
  if (_index) return _index
  let listed = null
  try {
    listed = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 << 20,
    })
  } catch {
    return null
  }
  const map = new Map()
  for (const f of listed.split(/\r?\n/)) {
    if (!f.trim()) continue
    const b = path.basename(f)
    if (!map.has(b)) map.set(b, [])
    map.get(b).push(f)
  }
  _index = map
  return map
}

/**
 * 解析一个锚点。返回 {abs, 态}：
 *  真 / 行越界 / 同名歧义（裸文件名且仓库里多于一份）/ 找不到。
 * 裸文件名写法在旧审件里占多数 —— 它不可机械复核，这正是要单独量出来的东西。
 */
export function resolveAnchor(raw, bases, root = ROOT) {
  const p = raw.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!p.includes('/')) {
    const idx = baseIndex(root)
    if (!idx) return { 态: '索引不可用' }
    const cands = idx.get(path.basename(p)) || []
    if (!cands.length) return { 态: '找不到' }
    if (cands.length > 1) return { 态: '同名歧义', 候选: cands.length }
    return { abs: path.join(root, cands[0]), 态: null }
  }
  for (const base of bases) {
    const abs = path.join(base, p)
    if (existsSync(abs) && statSync(abs).isFile()) return { abs, 态: null }
  }
  return { 态: '找不到' }
}

/**
 * 抽锚点并分类：真实率只在「可机械定位」的子集上算，可复核率单列（裸文件名写法是新发现的靶子）。
 * 内容级下限（1004-QC-03）：真 = 行界内 **且目标行非空白**——旧实现只查 `1<=line<=fileLines`，
 * 指到空行也算「真」；excerpt 级内容核对由抽检（anchor-spot 手法）承担，不在本量尺内冒充。
 */
export function auditAnchors(md, batchDir) {
  const bases = [ROOT, batchDir, path.dirname(batchDir)]
  const hits = []
  for (const m of md.matchAll(ANCHOR_RE)) {
    const line = Number(m[2])
    const r = resolveAnchor(m[1], bases)
    let 状态 = r.态
    if (!状态) {
      if (line < 1 || line > fileLines(r.abs)) 状态 = '行越界'
      else {
        const 目标行 = linesOf(r.abs)[line - 1] ?? ''
        状态 = 目标行.trim() ? '真' : '空白行'
      }
    }
    hits.push({
      锚点: `${m[1]}:${m[2]}`,
      状态,
      解析到: r.abs ? path.relative(ROOT, r.abs).replace(/\\/g, '/') : null,
    })
  }
  const cnt = (t) => hits.filter((h) => h.状态 === t).length
  // 可核 = 机械定位成功（真/行越界/空白行都算定位到）；空白行与越界都拉低真实率
  const 可核 = cnt('真') + cnt('行越界') + cnt('空白行')
  const 真集 = new Set(hits.filter((h) => h.状态 === '真').map((h) => h.锚点))
  return {
    命中: hits,
    总数: hits.length,
    真: cnt('真'),
    行越界: cnt('行越界'),
    空白行: cnt('空白行'),
    歧义: cnt('同名歧义'),
    找不到: cnt('找不到'),
    可核,
    真实率: 可核 ? cnt('真') / 可核 : null,
    可复核率: hits.length ? 可核 / hits.length : null,
    去重数: new Set(hits.map((h) => h.锚点)).size,
    去重真: 真集.size,
    失效样本: hits.filter((h) => h.状态 !== '真').slice(0, 8),
  }
}

/**
 * §0 契约：抽得出块、且块内每条命令都紧跟一行 `# 期望:`。
 * 判据面**只限 §0 章节**（1004-QC-03）：旧实现 `extractBashBlocks(全文)` 把 §3 钩子清单里
 * 带 `# 期望:` 的块也算进「可复跑判据」，名额被非 §0 内容充数。
 */
export function auditHooks(md) {
  const lines = md.split(/\r?\n/)
  const s = lines.findIndex((l) => /^#{1,3}\s*§?0\b/.test(l))
  let scope = ''
  if (s >= 0) {
    let e = lines.length
    for (let i = s + 1; i < lines.length; i++)
      if (/^##\s/.test(lines[i])) {
        e = i
        break
      }
    scope = lines.slice(s, e).join('\n')
  }
  const blocks = extractBashBlocks(scope)
  let 命令 = 0
  let 带期望 = 0
  const 裸命令 = []
  for (const b of blocks) {
    const blines = b.split(/\r?\n/)
    for (let i = 0; i < blines.length; i++) {
      const l = blines[i]
      if (!l.trim() || /^\s*#/.test(l) || /^\s*(cd|export|set|for|done|\})\b/.test(l)) continue
      命令++
      const next = blines.slice(i + 1, i + 3).find((x) => x && x.trim())
      if (next && /^# 期望:/.test(next.trim())) 带期望++
      else 裸命令.push(l.trim().slice(0, 60))
    }
  }
  return { 块数: blocks.length, 命令, 带期望, 裸命令, '无§0': s < 0 }
}

/** 覆盖率：负责集里每条指标是否被点名并给出可判定的结论词 */
export function auditCoverage(md, 负责) {
  const judged = []
  const 漏 = []
  for (const id of 负责) {
    const 文内 = id.replace(/^专\d+-/, '')
    // 不用 \b：ID 以汉字「专」开头，JS 的 \b 按 ASCII \w 定义，边界判定会整体失配
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(
      `(?<![\\d.])${esc}(?![\\d.])|指标\\s*${文内.replace('.', '\\.')}(?![\\d])`
    )
    const hit = md.split(/\r?\n/).find((l) => re.test(l))
    if (hit && VERDICT_RE.test(hit)) judged.push(id)
    else 漏.push(id)
  }
  const 全部 = [...md.matchAll(/专[1-8]-\d+\.\d+′?/g)].map((m) => m[0])
  const 越界 = [...new Set(全部.filter((x) => !负责.includes(x)))]
  return {
    判定点: judged,
    未判: 漏,
    越界,
    覆盖率: 负责.length ? judged.length / 负责.length : null,
  }
}

/** 归属四态 + RC 打标：只报产物里真有的标签，没打标就明说，不替窗口编数 */
export function auditTags(md) {
  const 标签 = { 引入: 0, 收口不足: 0, 取证漏: 0, 流程: 0 }
  const RC = { RC1: 0, RC2: 0, RC3: 0, RC4: 0 }
  for (const m of md.matchAll(new RegExp(RC_RE.source, 'gu'))) RC[`RC${m[1]}`]++
  const 行 = md.split(/\r?\n/)
  let 带归属 = 0
  for (const l of 行) {
    // 标签两形态都认（1004-QC-07）：反引号 `引入` 与 归属：**引入**；同一行只记一次归属
    const attr = l.match(TAG_ATTRIB_RE)
    if (attr) {
      标签[attr[1]]++
      带归属++
      continue
    }
    const bt = [...l.matchAll(TAG_BACKTICK_RE)]
    if (bt.length) {
      for (const x of bt) 标签[x[1]]++
      带归属++
    }
  }
  const 条目 = 行.filter(isEntryLine).length
  const 字面 = 标签.引入 + 标签.收口不足
  return {
    标签,
    RC,
    修复条目数: 条目,
    带归属条目数: 带归属,
    未打标: Math.max(0, 条目 - 带归属),
    膨胀率分子: 字面,
    膨胀率: 条目 ? +(字面 / 条目).toFixed(2) : null,
  }
}

export function loadClaims(batchDir) {
  const f = path.join(batchDir, 'claims.json')
  if (!existsSync(f)) return null
  const j = JSON.parse(readFileSync(f, 'utf8'))
  return new Map(j.窗.map((w) => [w.id, w.指标]))
}

export function windowFiles(batchDir) {
  // 全部非 00-记分卡/README 的 .md 都纳入（1004-QC-06：混合命名批次里 W*.md 曾让
  // 非 W 窗件与问题副本被吞；W 文件仍以 `W\d+` 作 id 以对齐 claims.json）。
  // 例外二（1005-QC-02）：`*问题副本*` 是窗口 §2 的**衍生物**（问题清单副本），不是判定窗；
  // 把它当窗会让「无负责集的窗」凭空多一条，覆盖率分母的读法跟着被带偏。
  const out = []
  const walk = (dir, depth) => {
    if (depth > 3) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) walk(abs, depth + 1)
      // 1004-17：00-* 窗口件（如 00-审查体系逐行复核-执行记录.md）必须纳入批次质量数；
      // 只排除两类**非窗口**：00-记分卡.md（本工具产物）与 README（说明件）。
      else if (
        /\.md$/.test(e.name) &&
        !/^README/.test(e.name) &&
        !/^00-记分卡/.test(e.name) &&
        !/^00-派单账/.test(e.name) &&
        !/问题副本/.test(e.name)
      ) {
        const w = e.name.match(/^(W\d+)\b/)
        out.push({
          id: w ? w[1] : path.relative(batchDir, abs).replace(/\\/g, '/'),
          file: abs,
        })
      }
    }
  }
  walk(batchDir, 0)
  const seen = new Set()
  for (const f of out) {
    // W id 撞号（W1.md 与 W1-补.md 并存）⇒ 退回相对路径，绝不静默覆盖
    if (seen.has(f.id)) f.id = path.relative(batchDir, f.file).replace(/\\/g, '/')
    seen.add(f.id)
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function scoreBatch(batchDir) {
  const claims = loadClaims(batchDir)
  const files = windowFiles(batchDir)
  const 窗账 = []
  for (const w of files) {
    const md = readFileSync(w.file, 'utf8')
    const 负责 = claims?.get(w.id) || []
    窗账.push({
      id: w.id,
      件: path.relative(ROOT, w.file).replace(/\\/g, '/'),
      覆盖: auditCoverage(md, 负责),
      锚点: auditAnchors(md, batchDir),
      判据: auditHooks(md),
      标签: auditTags(md),
      负责数: 负责.length,
    })
  }
  const sum = (fn) => 窗账.reduce((n, w) => n + fn(w), 0)
  const 锚总 = sum((w) => w.锚点.总数)
  const 锚真 = sum((w) => w.锚点.真)
  const 判据总 = sum((w) => w.判据.带期望)
  const 条目总 = sum((w) => w.标签.修复条目数)
  const 分子总 = sum((w) => w.标签.膨胀率分子)
  const batch = {
    目录: path.relative(ROOT, batchDir).replace(/\\/g, '/'),
    窗数: 窗账.length,
    有claims: !!claims,
    总: {
      覆盖: 窗账.length && claims ? sum((w) => w.覆盖.判定点.length) / sum((w) => w.负责数) : null,
      锚点总数: 锚总,
      锚点可核数: sum((w) => w.锚点.可核),
      锚点歧义: sum((w) => w.锚点.歧义),
      锚点找不到: sum((w) => w.锚点.找不到),
      锚点真实率: sum((w) => w.锚点.可核) ? +(锚真 / sum((w) => w.锚点.可核)).toFixed(4) : null,
      可复核率: 锚总 ? +(sum((w) => w.锚点.可核) / 锚总).toFixed(4) : null,
      可复跑判据: 判据总,
      膨胀率: 条目总 ? +(分子总 / 条目总).toFixed(2) : null,
      修复条目数: 条目总,
      未打标条目数: sum((w) => w.标签.未打标),
      标签合计: 窗账.reduce(
        (a, w) => {
          for (const k of Object.keys(a)) a[k] += w.标签.标签[k]
          return a
        },
        { 引入: 0, 收口不足: 0, 取证漏: 0, 流程: 0 }
      ),
      RC合计: 窗账.reduce(
        (a, w) => {
          for (const k of Object.keys(a)) a[k] += w.标签.RC[k]
          return a
        },
        { RC1: 0, RC2: 0, RC3: 0, RC4: 0 }
      ),
      越界: [...new Set(窗账.flatMap((w) => w.覆盖.越界))],
      未取证: 窗账.filter((w) => !w.负责数).map((w) => w.id),
    },
    门槛: {
      绝对锚点: 锚总 >= THRESHOLD.绝对锚点 ? '达标' : '未达标',
      锚点真实率: !sum((w) => w.锚点.可核)
        ? '未取证（无可机械定位的锚点）'
        : 锚真 / sum((w) => w.锚点.可核) >= THRESHOLD.锚点真实率
          ? '达标'
          : '未达标',
      可复跑判据: 判据总 >= THRESHOLD.可复跑判据 ? '达标' : '未达标',
      覆盖率: !claims ? '未取证（无 claims.json ⇒ 无负责集，覆盖率无从谈起）' : '已算',
    },
    窗账,
  }
  return batch
}

export function renderScore(b) {
  const rows = b.窗账
    .map(
      (w) =>
        `| ${w.id} | ${w.负责数} | ${w.负责数 ? `${(w.覆盖.覆盖率 * 100).toFixed(0)}%（未判 ${w.覆盖.未判.length}）` : '未取证'} | ${w.锚点.总数}/${w.锚点.可核} | ${w.锚点.可核 ? `${(w.锚点.真实率 * 100).toFixed(1)}%` : '未取证'} | ${w.判据.块数}/${w.判据.带期望} | ${w.标签.标签.引入}/${w.标签.标签.收口不足} |`
    )
    .join('\n')
  // 判定分两栏（1005-QC-02 同族）：未达标是红，未取证是缺输入——两者都不是「通过」，
  // 旧写法在「无未达标项」时打一句「全部门槛达标」，会把未取证一起读成达标（名实不符）。
  const 未达 = Object.entries(b.门槛).filter(([, v]) => v === '未达标')
  const 未证 = Object.entries(b.门槛).filter(([, v]) => String(v).startsWith('未取证'))
  return `# ${path.basename(b.目录)} 记分卡（生成件，勿手改）

> 生成：\`node tools/audit-kit/scorecard.mjs ${b.目录}\`
> 五个数的口径都在这一个文件里；文档引用口径不得另抄数字（门槛唯一定义 \`tools/audit-kit/scorecard.mjs\` THRESHOLD）。

| 窗 | 负责指标 | 覆盖率 | 锚点 引用/可核 | 可核子集真实率 | §0 块/带期望命令 | 引入/收口不足 |
| --- | --- | --- | --- | --- | --- | --- |
${rows}

## 批次合计

- 覆盖率：${b.总.覆盖 === null ? '未取证' : `${(b.总.覆盖 * 100).toFixed(1)}%`}（分母 = claims.json 的负责集，窗口无权改）
- 锚点：${b.总.锚点总数} 处引用，其中可机械定位 ${b.总.锚点可核数}（**可复核率 ${b.总.可复核率 ?? '未取证'}**）；定位不了的构成：同名裸文件 ${b.总.锚点歧义} / 找不到 ${b.总.锚点找不到}
- 锚点真实率（只在可核子集上算）：${b.总.锚点真实率 ?? '未取证'}；门槛 ≥${THRESHOLD.绝对锚点} 处引用 / ≥${THRESHOLD.锚点真实率 * 100}% ⇒ **${b.门槛.绝对锚点}／${b.门槛.锚点真实率}**
- 可复跑判据（§0 内带 \`# 期望:\` 的命令数）：${b.总.可复跑判据}；门槛 ≥${THRESHOLD.可复跑判据} ⇒ **${b.门槛.可复跑判据}**
- 膨胀率 =（引入 + 收口不足）÷ 修复条目 = ${b.总.标签合计.引入 + b.总.标签合计.收口不足} ÷ ${b.总.修复条目数} = **${b.总.膨胀率 ?? '未取证'}**；其中 ${b.总.未打标条目数} 条无归属标签 ⇒ 该数按「取证漏」计，不等于 0
- RC 打标合计：${JSON.stringify(b.总.RC合计)}（未打标的条目按「取证漏」计，不替窗口编数）
- 越界引用（写了不属于自己的指标）：${b.总.越界.length ? b.总.越界.join(' ') : '无'}
- 无负责集的窗（未派单或未回填 claims）：${b.总.未取证.length ? b.总.未取证.join(' ') : '无'}

## 失效锚点样本（每窗 ≤8 条，用于定根因：是代码改了、还是当初就没这行）

${
  b.窗账
    .filter((w) => w.锚点.失效样本.length)
    .map((w) => `- ${w.id}：${w.锚点.失效样本.map((h) => `${h.锚点}[${h.状态}]`).join(' ')}`)
    .join('\n') || '- 无失效锚点'
}

## 判定

${
  未达.length
    ? 未达.map(([k, v]) => `- **${k} ${v}**`).join('\n')
    : 未证.length
      ? '- 无未达标项（不等于全绿：下列未取证项缺输入）'
      : '- 全部门槛达标（本行仅在无未达标项时出现）'
}
${未证.map(([k, v]) => `- **${k} 未取证**：${v}`).join('\n')}
- 未取证 ≠ 通过（AGENTS §5.4）：凡标「未取证」的，缺的是输入产物，不是判据。
`
}

/**
 * 门槛失败项（CLI 与单测共用同一份判定）。
 * 默认只红「未达标」；--strict 下「未取证」同样红——批末门禁口径：claims.json 是交件必填，
 * 缺它覆盖率就没有输入，不许以 exit 0 混过（1005-QC-02）。
 */
export function failedThresholds(b, strict = false) {
  return Object.entries(b.门槛).filter(
    ([, v]) => v === '未达标' || (strict && String(v).startsWith('未取证'))
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const dir = argv.find((a) => !a.startsWith('--'))
  if (!dir || !existsSync(dir)) {
    console.error(
      '用法: node tools/audit-kit/scorecard.mjs <批次目录> [--out <文件>] [--json] [--strict]'
    )
    process.exit(2)
  }
  const strict = argv.includes('--strict')
  const b = scoreBatch(path.resolve(dir))
  if (argv.includes('--json')) console.log(JSON.stringify(b, null, 1))
  else {
    const md = renderScore(b)
    const out = argv.includes('--out')
      ? argv[argv.indexOf('--out') + 1]
      : path.join(path.resolve(dir), '00-记分卡.md')
    writeFileSync(out, md)
    console.log(md)
    console.log(`已写 ${path.relative(ROOT, out)}`)
  }
  const bad = failedThresholds(b, strict)
  if (strict && bad.length) {
    console.error(
      `[scorecard] --strict 未通过：${bad.map(([k, v]) => `${k}=${v}`).join('；')}` +
        '（未取证 = 缺输入产物，补齐再重跑；本模式是批末门禁口径）'
    )
  }
  process.exit(bad.length ? 1 : 0)
}
