#!/usr/bin/env node
/**
 * build-kp-map — 从「迁移基线快照」抽取知识点（KP），生成迁移期权威切换表。
 *
 * 输入：tools/doc-system/baseline/（冻结的旧文档，来源与 sha256 见 manifest.json）
 *   为什么读快照而不读工作树：迁移期旧文档要被加并行期横幅、被零改写移入日志层，
 *   读工作树会让同一份 KP 表的锚点随迁移漂移，且移动/浅克隆后直接失效。
 *   —— 判据的输入必须受版本控制（AGENTS §5.4）。
 *
 * 粒度：标题级（## / ###）——每条规则、每个小节、每个固定块算一个 KP。
 * 输出：
 *   tools/doc-system/kp-map.json          机读（守卫 doc-map-check 消费）
 *   docs/日志/迁移/KP清单-<date>.md        人读视图（日志层，默认不入库）
 *
 * 用法：node tools/doc-system/build-kp-map.mjs
 * 权威规则：目标登记项 status ∈ {active, frozen} ⇒ authority=new（frozen = 记录件已承接该 KP）；
 *   其余（stub/planned/parallel/external）⇒ old。
 * 迁移推进时先改 doc-map.json 的 status，再重跑本脚本。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DOC_MAP = path.join(ROOT, 'tools/v3-guard/lib/doc-map.json')
const BASELINE_DIR = 'tools/doc-system/baseline'
const MANIFEST = path.join(ROOT, BASELINE_DIR, 'manifest.json')
const OUT_JSON = path.join(ROOT, 'tools/doc-system/kp-map.json')
const DATE = process.env.KP_DATE || '2026-10-05'

const docMap = JSON.parse(fs.readFileSync(DOC_MAP, 'utf8'))
const statusById = new Map(docMap.docs.map((d) => [d.id, d.status]))
/** 承接 KP 的状态：active（现行契约/宪法）与 frozen（冻结记录件，内容已落盘且只读） */
const KP_NEW_STATUSES = new Set(['active', 'frozen'])
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))

/**
 * 旧文档章节 → 新体系目标（KP 粒度：h2 按章节号；h3 继承 h2；个别文件按标题关键字）。
 * 跨旧文档重组（1→多、多→1）都只是这里的映射行；目标必须已登记在 doc-map.json。
 */
const SECTION_MAP = {
  'AGENTS.md': {
    byNumeral: {
      一: 'AGENTS',
      二: 'AGENTS',
      三: 'K4',
      四: 'AGENTS',
      五: 'AGENTS',
      六: 'K4',
      七: 'AGENTS',
      八: 'K4',
      九: 'AGENTS',
      十: 'C2',
      十一: 'STD',
      十二: 'K4',
    },
    default: 'AGENTS',
  },
  'CLAUDE.md': {
    byHeading: { 技术栈速览: 'C1', 只给指路: 'AGENTS', 本文件的机器约束: 'AGENTS' },
    default: 'AGENTS',
  },
  'docs/README.md': { default: 'MAP' },
  'docs/根基文档/项目全景.md': {
    byNumeral: {
      一: 'C1',
      二: 'C1',
      三: 'C1',
      四: 'C1',
      五: 'C2',
      六: 'C1',
      七: 'C3',
    },
    default: 'C1',
  },
  'docs/根基文档/核心流程与数据流.md': {
    byNumeral: {
      一: 'K2',
      二: 'K2',
      三: 'K2',
      四: 'K2',
      五: 'K2',
      六: 'K2',
      七: 'K4',
    },
    default: 'K2',
  },
  'docs/根基文档/开发指南与决策.md': {
    byNumeral: {
      一: 'K2',
      二: 'K4',
      三: 'K2',
      四: 'K3',
      五: 'K4',
      六: 'S3',
      七: 'LOG-DECISIONS',
      八: 'K4',
      九: 'K4',
      十: 'C1',
      十一: 'K4', // 2026-10-05 更正：原指 K1 未落内容，实际全量承接在 K4 §10
    },
    default: 'K2',
  },
  'docs/根基文档/04-防复发清单.md': { default: 'K1' },
  'docs/开工前必读/API契约文档.md': { default: 'K3' },
  'docs/根基文档/代码知识库.md': { default: 'SNAP-KB' },
  'docs/根基文档/项目收敛路线图.md': { default: 'SNAP-ROADMAP' },
  'docs/开工前必读/接力文档.md': { default: 'S3' },
}

const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']
const CN_ALT = [...CN].sort((a, b) => b.length - a.length).join('|')
const HEADING_RE = /^(#{2,3})\s+(.+)$/gm

function pickTarget(file, h2Heading, heading) {
  const map = SECTION_MAP[file]
  if (!map) throw new Error(`未登记 KP 映射规则的源文件：${file}`)
  const scope = h2Heading || heading
  if (map.byHeading) {
    for (const [key, target] of Object.entries(map.byHeading)) {
      if (scope.includes(key)) return target
    }
  }
  if (map.byNumeral) {
    const m = h2Heading ? h2Heading.match(new RegExp(`^##\\s*(${CN_ALT})`)) : null
    if (m && map.byNumeral[m[1]]) return map.byNumeral[m[1]]
  }
  return map.default
}

function excerptAfter(lines, startIdx) {
  for (let i = startIdx + 1; i < lines.length; i++) {
    const l = lines[i].trim()
    if (!l) continue
    if (/^#{1,6}\s/.test(l)) break
    if (/^-{3,}$/.test(l) || /^```/.test(l)) continue
    return l
      .replace(/[`*_>#]/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 50)
  }
  return ''
}

const sources = []
const kps = []
let seq = 0
for (const entry of manifest.files) {
  const file = entry.doc
  const abs = path.join(ROOT, entry.file)
  if (!fs.existsSync(abs))
    throw new Error(`基线快照缺失：${entry.file}（先跑快照脚本或核对 manifest）`)
  const text = fs.readFileSync(abs, 'utf8')
  const lines = text.split(/\r?\n/)
  const sections = []
  const hits = [...text.matchAll(HEADING_RE)]
  let currentH2 = null
  for (const m of hits) {
    const level = m[1].length
    const heading = m[2].trim()
    const lineNo = text.slice(0, m.index).split(/\r?\n/).length
    if (level === 2) currentH2 = m[0].trim()
    const target = pickTarget(file, currentH2, m[0].trim())
    const anchor = `${file}:${lineNo}`
    sections.push({ heading: m[0].trim(), anchor, level })
    seq += 1
    kps.push({
      id: `KP-${String(seq).padStart(3, '0')}`,
      source: file,
      anchor,
      heading: m[0].trim(),
      excerpt: excerptAfter(lines, lineNo - 1),
      layer: docMap.docs.find((d) => d.id === target)?.layer ?? '待迁移',
      target,
      authority: KP_NEW_STATUSES.has(statusById.get(target)) ? 'new' : 'old',
      status: 'mapped',
      verifiedBy: 'heading',
    })
  }
  sources.push({ id: file, doc: file, file: entry.file, sha256: entry.sha256, sections })
}

const out = {
  version: 1,
  date: DATE,
  baseline: {
    dir: BASELINE_DIR,
    manifest: `${BASELINE_DIR}/manifest.json`,
    commit: manifest.baselineCommit,
  },
  sources,
  kps,
}
fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true })
fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + '\n', 'utf8')

// 人读视图（日志层，默认不入库）
const viewDir = path.join(ROOT, 'docs/日志/迁移')
fs.mkdirSync(viewDir, { recursive: true })
const byTarget = new Map()
for (const k of kps) {
  if (!byTarget.has(k.target)) byTarget.set(k.target, [])
  byTarget.get(k.target).push(k)
}
const view = [
  `# KP 迁移清单（${DATE}）`,
  '',
  `> 生成：\`node tools/doc-system/build-kp-map.mjs\`；机读件 \`tools/doc-system/kp-map.json\`。`,
  `> 输入：\`${BASELINE_DIR}/\`（基线 ${manifest.baselineCommit.slice(0, 8)}，逐字节冻结）；粒度：标题级（## / ###）。`,
  `> 权威：目标 active ⇒ new；其余 ⇒ old。覆盖率 = 有目标 KP / 基线全部标题。`,
  '',
  `## 汇总`,
  '',
  `- 源文件 ${sources.length} 个；知识点 ${kps.length} 条。`,
  ...[...byTarget.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([t, list]) => `- → ${t}：${list.length} 条（${statusById.get(t) ?? '未登记'}）`),
  '',
  `## 明细`,
  '',
  ...[...byTarget.entries()].flatMap(([t, list]) => [
    `### → ${t}`,
    '',
    ...list.map(
      (k) =>
        `- \`${k.id}\` ${k.anchor}｜${k.heading.replace(/^#+\s*/, '')}｜${k.excerpt || '（无摘要）'}`
    ),
    '',
  ]),
].join('\n')
fs.writeFileSync(path.join(viewDir, `KP清单-${DATE}.md`), view, 'utf8')

console.log(
  `[build-kp-map] OK：源 ${sources.length} 件 / KP ${kps.length} 条 → ${path.relative(ROOT, OUT_JSON)}`
)
