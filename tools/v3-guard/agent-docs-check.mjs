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
 *   **例外（2026-09-25 修）**：目标在**版本控制之外**（gitignored，如协议指引「长证据落
 *   `.local/`」）时不做存在性断言。依据 AGENTS §5.4「判据的输入必须受版本控制，不得读
 *   gitignored 路径」—— 这类路径本就不会出现在干净检出/CI 里，对它断言等于让门禁在 CI
 *   上**恒红**且本地看不出来（本地有 `.local/`，CI 没有）。这是修正输入口径，不是放宽。
 * 断言 2（裸 .md 引用）：协议里 `01-项目全景.md` 这种不带目录的文件名，必须在
 *   {仓库根, docs/, docs/根基文档/} 里唯一命中——0 命中是断链，多命中是歧义。
 * 断言 3（commit 口径）：协议里 `例：` 给出的提交示例必须真能过 commitlint；同时把该示例
 *   的 `type(scope):` 前缀剥掉得到的**反向样本必须被拒**。反向样本若也放行，说明
 *   commitlint 根本没生效、断言 3 成了恒真摆设——按 tmp-hygiene 2026-09-18 的教训，
 *   守卫自己失效必须当场报红，不许静默 OK。
 *   **工具不可用时记 SKIPPED 并计入报告，不判红也不判绿**（AGENTS §5.4）——CLI 缺失是
 *   环境问题，不是协议失真；把它判红会让"没装依赖的干净检出"看起来像文档写错了。
 *   同一断言还钉**口径单源**：协议与决策文档都禁 `type(scope):`，故把示例改写成带 scope
 *   的形态后必须被拒（对应 `package.json` → `commitlint.rules.scope-empty`）；文档写"禁"
 *   而配置不拦，就是零机器判据的空宣称（W13）。
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
  'docs/文档地图.md',
  'docs/宪法/C1-项目宪法.md',
  'docs/宪法/C2-质量不变量与根因守则.md',
  'docs/宪法/C3-信息源宪法.md',
  'docs/契约/K1-技术规则集.md',
  'docs/契约/K2-架构与流程契约.md',
  'docs/契约/K3-接口与数据契约.md',
  'docs/契约/K4-开发与门禁契约.md',
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
  exists = (rel) => fs.existsSync(path.join(ROOT, rel)),
  isIgnored = () => false
) {
  const bad = []
  for (const rel of files) {
    const abs = path.join(ROOT, rel)
    if (!fs.existsSync(abs)) {
      bad.push({ file: rel, line: 0, ref: rel, why: '索引声明的活文档本身不存在' })
      continue
    }
    for (const r of prefixedRefs(fs.readFileSync(abs, 'utf8'))) {
      // 与 checkRefs 同口径：gitignored 目标不会出现在干净检出/CI，不得做存在性断言
      // （本地未入库文件存在 ⇒ 本地绿、CI 红的假绿正是这条缺失造成的）。
      if (r.exempt || exists(r.token) || isIgnored(r.token)) continue
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
 * 目标是否在**版本控制之外**（gitignored）。按 AGENTS §5.4，判据不得对这类目标做存在性
 * 断言 —— 它本就不会出现在干净检出/CI 里。只在"看起来违规"时才 spawn git，正常路径零开销。
 */
export function isGitIgnored(rel) {
  // `stdio: 'ignore'` 是必须的：受限执行环境拒绝**管道式**子进程，spawnSync 会返回
  // status=null，于是本函数恒返回 false、豁免静默失效（本仓第三次踩同一个坑 ——
  // 前两次见 mutation-probe 与 runCommitlint）。这里只要退出码，不需要任何输出。
  const r = spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: ROOT, stdio: 'ignore' })
  return r.status === 0
}

/**
 * @param {Array<{token: string, line: number}>} entries 已带来源文件标注的片段
 * @param {(rel: string) => boolean} exists
 * @param {(rel: string) => boolean} isIgnored 版本控制之外 ⇒ 跳过存在性断言（默认不豁免，
 *   保持纯函数的可测性与"默认从严"）
 */
export function checkRefs(
  entries,
  exists = (rel) => fs.existsSync(path.join(ROOT, rel)),
  isIgnored = () => false
) {
  const bad = []
  for (const e of entries) {
    const c = classify(e.token)
    if (!c) continue
    if (c.kind === 'prefixed') {
      if (exists(c.value)) continue
      if (isIgnored(c.value)) continue
      bad.push({ ...e, ref: c.value, why: '带目录前缀的引用从仓库根不存在' })
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

  // 输出捕获**不走** `encoding:'utf8'` 的匿名管道：受限执行环境（加固终端 / 本仓沙箱）会
  // 拒绝创建管道子进程（实测 spawnSync 报 EBUSY），那会让断言 3 退化成"环境不可用"而红，
  // 把真实的 commitlint 行为整个掩盖掉。改为：
  //   ① 消息写临时文件、用 `--edit <file>` 传入 —— 与 `.husky/commit-msg` 的调用方式一致；
  //   ② stdout/stderr 重定向到文件描述符，不建管道。
  // 判据（正向示例必须过 / 剥 type 必须拒 / 带 scope 必须拒）逐字不变。
  const tmpDir = path.join(ROOT, '.local', 'tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const msgFile = path.join(tmpDir, `commitlint-msg-${stamp}.txt`)
  const outFile = path.join(tmpDir, `commitlint-out-${stamp}.log`)
  fs.writeFileSync(msgFile, `${message}\n`)

  const fd = fs.openSync(outFile, 'w')
  let r
  try {
    r = spawnSync(process.execPath, [cli, '--edit', msgFile], {
      cwd: ROOT,
      stdio: ['ignore', fd, fd],
    })
  } finally {
    fs.closeSync(fd)
  }
  let out = ''
  try {
    out = fs.readFileSync(outFile, 'utf8')
  } catch {
    /* 读不到即空，不改变 rc 判定 */
  }
  for (const f of [msgFile, outFile]) {
    try {
      fs.unlinkSync(f)
    } catch {
      /* 清理失败不改变判据 */
    }
  }
  return {
    rc: r.status,
    // spawn 失败时 status=null 且无 error.message 以外的线索：给一句可诊断的话，
    // 别再让上层打印 `undefined`（那会让守卫红得无法定位）
    why:
      r.status === null
        ? `commitlint 子进程未正常退出：${r.error?.message ?? '未知原因'}`
        : undefined,
    out,
  }
}

/**
 * @param {string} text 协议正文
 * @param {(msg: string) => {rc: number|null, why?: string}} lint commitlint 调用（可注入，便于
 *   测「工具不可用 ⇒ SKIPPED」这一格）
 * @returns {{violations: Array, skipped: Array}} 工具不可用的样本进 `skipped` ——
 *   §5.4：记 SKIPPED 并计入报告，**不判红也不判绿**
 */
export function checkCommitForm(text, lint = runCommitlint) {
  const violations = []
  const skipped = []
  const examples = extractCommitExamples(text)
  if (examples.length === 0) {
    return {
      violations: [
        { ref: '(无)', why: '协议里没有 `例：` 形式的可执行 commit 示例，口径无从校验' },
      ],
      skipped,
    }
  }
  for (const ex of examples) {
    const pass = lint(ex.message)
    if (pass.rc === null) {
      skipped.push({ ref: `commitlint(${ex.message})`, why: pass.why })
      continue
    }
    if (pass.rc !== 0) {
      violations.push({
        ref: ex.message,
        line: ex.line,
        why: '协议自己的 commit 示例过不了 commitlint（口径与 hook 实装脱节）',
      })
    }
  }

  // 反向样本必须被拒 —— 放行即「hook 规则没生效，本断言成了恒真摆设」
  const negative = stripCommitType(examples[0].message)
  const reject = lint(negative)
  if (reject.rc === null) {
    skipped.push({ ref: `commitlint(反向样本 ${negative})`, why: reject.why })
  } else if (reject.rc === 0) {
    violations.push({
      ref: negative,
      why: '反向样本（剥掉 type 前缀）未被 commitlint 拒绝 ⇒ hook 侧规则没生效，本断言是恒真摆设',
    })
  }

  // 口径（`AGENTS.md` §六 / `开发指南与决策.md` §1.6）：**禁 `type(scope):` 括号写法**。
  // 文档这么说就必须有机器判据——把示例同义改写成带 scope 的形态，断言 commitlint 拒它；
  // 若有人删掉 `package.json` 的 `commitlint.rules.scope-empty`，或把口径改回允许，这里立刻红。
  const scoped = examples[0].message.replace(/^([a-z][a-z-]*)!?:/, '$1(scope):')
  const scopedCheck = lint(scoped)
  if (scopedCheck.rc === null) {
    skipped.push({ ref: `commitlint(${scoped})`, why: scopedCheck.why })
  } else if (scopedCheck.rc === 0) {
    violations.push({
      ref: scoped,
      why: '口径禁 `type(scope):`，但带 scope 的样本被 commitlint 放行 ⇒ 口径无机器判据（需 package.json 的 commitlint.rules.scope-empty）',
    })
  }
  return { violations, skipped }
}

function run() {
  const refBad = []
  const commitBad = []
  const skipped = []
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
    for (const b of checkRefs(entries, undefined, isGitIgnored)) refBad.push({ file: rel, ...b })
    const cf = checkCommitForm(text)
    for (const b of cf.violations) commitBad.push({ file: rel, ...b })
    for (const s of cf.skipped) skipped.push({ file: rel, ...s })
  }

  const violations = [...refBad, ...checkLiveDocs(LIVE_DOCS, undefined, isGitIgnored), ...commitBad]
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ checked, violations, skipped }, null, 2))
    process.exit(violations.length ? 1 : 0)
  }
  // §5.4：工具不可用的断言记 SKIPPED 并计入报告（既不判红也不判绿）。单独打一行，
  // 免得「没装依赖的环境」看上去像「文档全部自洽」。
  for (const s of skipped) {
    console.log(`[agent-docs-check] SKIPPED ${s.file}  ${s.ref} —— ${s.why}`)
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
    `[agent-docs-check] OK：${PROTOCOL_DOCS.join(' + ')} 的 ${checked} 条路径引用与 commit 示例全部自洽` +
      (skipped.length ? `（另 ${skipped.length} 条断言因工具不可用记 SKIPPED）` : '')
  )
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) run()
