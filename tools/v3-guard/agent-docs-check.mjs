#!/usr/bin/env node
/**
 * agent-docs-check.mjs — 作业协议自述校验守卫
 *
 * 背景：`AGENTS.md` 会被自动注入每个 agent 会话（实测：新会话零工具调用即可复述其内容），
 * 协议写错等于所有 agent 一起错，而它恰恰是最容易漂移的文件——引用的文档改名、
 * commit 口径与 hook 实装脱节，都不会有任何测试为之变红。本守卫补上这条断言。
 *
 * 断言 1（带目录前缀的引用）：协议里 `docs/...`、`.husky/...`、`backend/...` 这类路径，
 *   必须能从仓库根精确解析。
 * 断言 2（裸 .md 引用）：协议里 `01-项目全景.md` 这种不带目录的文件名，必须在
 *   {仓库根, docs/, docs/根基文档/} 里唯一命中——0 命中是断链，多命中是歧义。
 * 断言 3（commit 口径）：协议里 `例：` 给出的提交示例必须真能过 commitlint；同时把该示例
 *   的 `type(scope):` 前缀剥掉得到的**反向样本必须被拒**。反向样本若也放行，说明
 *   commitlint 根本没生效、断言 3 成了恒真摆设——按 tmp-hygiene 2026-09-18 的教训，
 *   守卫自己失效必须当场报红，不许静默 OK。
 * 断言 4（活文档引用）：协议之外的链路文档（索引、根基文档、契约文档、工具 README）里
 *   带目录前缀的路径引用也必须存在。Express 与 FastAPI 退役后，文档里长期留着
 *   `backend/utils/response.js`、`backend/nest/tsconfig.json` 这类已不存在的路径，
 *   而没有任何断言会因此变红。行内含「历史快照 / 旧稿 / 已退役 / 不存在 / 已删除 / 作废」
 *   之一的，视为**有意引用死路径**（取证或历史留痕），按行豁免——豁免标记必须与该引用
 *   同一行，避免整份文档被开后门。
 *
 * 用法：
 *   node tools/v3-guard/agent-docs-check.mjs          # 校验（违规 exit 1）
 *   node tools/v3-guard/agent-docs-check.mjs --json   # 机器可读输出
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PROTOCOL_DOCS = ['AGENTS.md', 'CLAUDE.md']
const BARE_DIRS = ['', 'docs/', 'docs/根基文档/']

/** 通用名：协议里 `README.md` 指「各模块自己的 README」，多命中是有意为之 */
const GENERIC_BARE = new Set(['README.md', 'AGENTS.md', 'CLAUDE.md', 'package.json'])
/** 含这些字符的反引号串是命令/glob/占位符，不是路径 */
const NOT_A_PATH = /[\s*<>{}$|｜()=]/
const COMMIT_FORM = /^[a-z][a-z-]*(\([a-z0-9-]+\))?!?: \S/

/** 断言 4 的覆盖范围：会被人当现状读的链路文档（不含 audits/台账等历史快照） */
export const LIVE_DOCS = [
  'README.md',
  'docs/README.md',
  'docs/根基文档/项目全景.md',
  'docs/根基文档/核心流程与数据流.md',
  'docs/根基文档/开发指南与决策.md',
  'docs/根基文档/审查体系专项/审查体系约定.md',
  'docs/开工前必读/API契约文档.md',
  'tools/README.md',
  'tools/forecast/README.md',
  'backend/data/README.md',
]

/** 同写「此处有意引用一个已不存在的历史路径」，按行豁免 */
const INTENT_MARKERS = /历史快照|旧稿|已退役|已删除|不存在|作废/

/**
 * 只校验**仓库根锚定**的路径（首段是已知顶层目录）。
 * 收窄的理由：文档里还有大量 `根基文档/x.md`（相对 docs/ 索引）、`types/`（分层名）、
 * `experiment/v3-backend-migration`（分支名）——它们不是文件路径引用，纳入会把守卫
 * 淹成 88 条噪声，噪声守卫等于没有守卫。
 */
const ROOT_ANCHORS = ['backend/', 'frontend/', 'tools/', 'docs/', 'scripts/', '.github/', '.husky/']

/**
 * 抽出「仓库根锚定」的路径引用（目录/层级名带尾斜杠的不算）。
 * @returns {Array<{token: string, line: number, exempt: boolean}>}
 */
export function prefixedRefs(text) {
  const out = []
  text.split('\n').forEach((line, i) => {
    const exempt = INTENT_MARKERS.test(line)
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const c = classify(m[1])
      if (!c || c.kind !== 'prefixed' || c.value.endsWith('/')) continue
      if (!ROOT_ANCHORS.some((a) => c.value.startsWith(a))) continue
      out.push({ token: c.value, line: i + 1, exempt })
    }
  })
  return out
}

export function checkLiveDocs(
  files = LIVE_DOCS,
  exists = (rel) => fs.existsSync(path.join(ROOT, rel))
) {
  const bad = []
  for (const rel of files) {
    const abs = path.join(ROOT, rel)
    if (!fs.existsSync(abs)) {
      bad.push({ file: rel, line: 0, ref: rel, why: '索引声明的活文档本身不存在' })
      continue
    }
    for (const r of prefixedRefs(fs.readFileSync(abs, 'utf8'))) {
      if (r.exempt || exists(r.token)) continue
      bad.push({
        file: rel,
        line: r.line,
        ref: r.token,
        why: '活文档引用的路径不存在（或补「历史快照」按行豁免）',
      })
    }
  }
  return bad
}

/** 抽出正文里所有反引号片段，带行号 */
export function extractTokens(text) {
  const out = []
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/`([^`\n]+)`/g)) out.push({ token: m[1], line: i + 1 })
  })
  return out
}

/** 判定一个反引号片段是不是路径引用；不是则返回 null */
export function classify(token) {
  const t = token.replace(/:\d+$/, '') // `tools/db/db-schema.sql:77` 这类行号后缀
  if (!t) return null
  if (NOT_A_PATH.test(t) || t.startsWith('--') || t.startsWith('@') || t.includes('://'))
    return null
  if (t.includes('/')) return { kind: 'prefixed', value: t }
  if (t.endsWith('.md')) return { kind: 'bare-md', value: t }
  return null
}

/**
 * @param {Array<{token: string, line: number}>} entries 已带来源文件标注的片段
 * @param {(rel: string) => boolean} exists
 */
export function checkRefs(entries, exists = (rel) => fs.existsSync(path.join(ROOT, rel))) {
  const bad = []
  for (const e of entries) {
    const c = classify(e.token)
    if (!c) continue
    if (c.kind === 'prefixed') {
      if (!exists(c.value)) bad.push({ ...e, ref: c.value, why: '带目录前缀的引用从仓库根不存在' })
      continue
    }
    const hits = BARE_DIRS.map((d) => d + c.value).filter(exists)
    if (hits.length === 0) {
      bad.push({
        ...e,
        ref: c.value,
        why: `裸文件名在 ${BARE_DIRS.map((d) => d || '(根)').join('/')} 下都不存在`,
      })
    } else if (hits.length > 1 && !GENERIC_BARE.has(c.value)) {
      bad.push({ ...e, ref: c.value, why: `裸文件名多义：${hits.join(' 与 ')}` })
    }
  }
  return bad
}

/** 只认 `例：` 后面那个反引号串——占位符 `type(scope): 中文说明` 不带此前缀，不入样 */
export function extractCommitExamples(text) {
  const out = []
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/例[：:]\s*`([^`\n]+)`/g)) {
      if (COMMIT_FORM.test(m[1])) out.push({ message: m[1], line: i + 1 })
    }
  })
  return out
}

/** 剥掉 `type(scope):` 前缀，得到反向样本（应被 commitlint 拒） */
export function stripCommitType(message) {
  return message.replace(/^[a-z][a-z-]*(\([^)]*\))?!?:\s*/, '')
}

function runCommitlint(message) {
  const cli = path.join(ROOT, 'node_modules', '@commitlint', 'cli', 'cli.js')
  if (!fs.existsSync(cli)) return { rc: null, why: 'commitlint CLI 缺失，无法校验断言 3' }
  const r = spawnSync(process.execPath, [cli], {
    cwd: ROOT,
    input: `${message}\n`,
    encoding: 'utf8',
  })
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }
}

export function checkCommitForm(text) {
  const bad = []
  const examples = extractCommitExamples(text)
  if (examples.length === 0) {
    return [{ ref: '(无)', why: '协议里没有 `例：` 形式的可执行 commit 示例，口径无从校验' }]
  }
  for (const ex of examples) {
    const pass = runCommitlint(ex.message)
    if (pass.rc === null) return [{ ref: 'commitlint', why: pass.why }]
    if (pass.rc !== 0) {
      bad.push({
        ref: ex.message,
        line: ex.line,
        why: '协议自己的 commit 示例过不了 commitlint（口径与 hook 实装脱节）',
      })
    }
  }
  const negative = stripCommitType(examples[0].message)
  const reject = runCommitlint(negative)
  if (reject.rc === 0) {
    bad.push({
      ref: negative,
      why: '反向样本（剥掉 type 前缀）未被 commitlint 拒绝 ⇒ hook 侧规则没生效，本断言是恒真摆设',
    })
  }
  return bad
}

function run() {
  const refBad = []
  const commitBad = []
  let checked = 0
  for (const rel of PROTOCOL_DOCS) {
    const abs = path.join(ROOT, rel)
    if (!fs.existsSync(abs)) {
      refBad.push({ ref: rel, why: '协议文件本身不存在' })
      continue
    }
    const text = fs.readFileSync(abs, 'utf8')
    const entries = extractTokens(text).map((e) => ({ ...e, file: rel }))
    checked += entries.filter((e) => classify(e.token)).length
    for (const b of checkRefs(entries)) refBad.push({ file: rel, ...b })
    for (const b of checkCommitForm(text)) commitBad.push({ file: rel, ...b })
  }

  const violations = [...refBad, ...checkLiveDocs(), ...commitBad]
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ checked, violations }, null, 2))
    process.exit(violations.length ? 1 : 0)
  }
  if (violations.length) {
    console.log(
      `[agent-docs-check] ${violations.length} 处协议自述失真（共校验 ${checked} 条引用/示例）：`
    )
    for (const v of violations) {
      console.log(`  - ${v.file}${v.line ? `:${v.line}` : ''}  ${v.ref}`)
      console.log(`      ${v.why}`)
    }
    console.log(
      '处理：改协议里的引用为真实路径，或给目标文件补上编号前缀（两者取一，勿放宽本守卫）。'
    )
    process.exit(1)
  }
  console.log(
    `[agent-docs-check] OK：${PROTOCOL_DOCS.join(' + ')} 的 ${checked} 条路径引用与 commit 示例全部自洽`
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) run()
