#!/usr/bin/env node
/**
 * doc-map-check — 信息源三层登记与读写矩阵守卫。
 *
 * 治的是什么：文档体系一旦分成三层（宪法/契约/日志），
 *   ① 没人登记的新文档会悄悄长成第二个权威源；
 *   ② 同一条事实可以同时留在两处（迁移期双权威）；
 *   ③ 契约"改了不留时间戳"、日志"没有日期"都会让"谁是现行口径"不可判；
 *   ④ AGENTS §二的读写矩阵与机器登记表各写一份、必然漂移。
 * 本守卫把这四件事变成能红的判据；红样常驻 __tests__/doc-map-check.test.mjs。
 *
 * 四条硬口径（AGENTS §5.4）同样适用：输入全部来自受版本控制的文件；
 * 本机不存在的路径只对声明了 external:true 的登记项豁免。
 *
 * 用法：node tools/v3-guard/doc-map-check.mjs [--json]
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const DOC_MAP_PATH = 'tools/v3-guard/lib/doc-map.json'
export const KP_MAP_PATH = 'tools/doc-system/kp-map.json'
export const ACTIVE_DIRS = ['docs/宪法', 'docs/契约', 'docs/日志']

const LAYERS = new Set(['宪法', '契约', '日志', '标准库', '待迁移'])
const STATUSES = new Set(['active', 'stub', 'planned', 'parallel', 'frozen', 'external', 'retired'])

/**
 * 纯函数：登记表 + KP 表 + 现场采集 → 问题列表。
 * 现场输入全部通过参数注入，便于红样测试（不读全局）。
 * @returns {Array<{code: string, msg: string}>}
 */
export function auditDocMap(input) {
  const {
    docs = [],
    facts = [],
    tasks = [],
    kp = null,
    meta = {},
    agentsText = '',
    trackedUnderActiveDirs = [],
    exists = () => false,
    gitDate = () => null,
    readText = () => null,
  } = input

  const problems = []
  const push = (code, msg) => problems.push({ code, msg })
  const byId = new Map()

  // ── 1. 登记项完整性 ────────────────────────────────────────────────
  for (const d of docs) {
    if (!d.id) push('DOC-ID', '存在无 id 的登记项')
    else if (byId.has(d.id)) push('DOC-ID', `文档 id 重复：${d.id}`)
    else byId.set(d.id, d)

    if (!LAYERS.has(d.layer)) push('DOC-LAYER', `${d.id} 层级非法：${d.layer}`)
    if (!STATUSES.has(d.status)) push('DOC-STATUS', `${d.id} 状态非法：${d.status}`)
    if (!d.role) push('DOC-ROLE', `${d.id} 缺 role`)
    if (d.guard && !exists(d.guard)) push('DOC-GUARD', `${d.id} 登记的守卫不存在：${d.guard}`)
    if (d.status === 'active' && (!d.readWhen?.length || !d.writeWhen?.length)) {
      push('DOC-IO', `${d.id} 为 active 但缺 readWhen/writeWhen`)
    }
    if (d.status === 'planned' && !d.planBatch)
      push('DOC-PLAN', `${d.id} 为 planned 但缺 planBatch`)

    const mustExist = ['active', 'stub', 'parallel', 'frozen'].includes(d.status)
    if (mustExist && !exists(d.path)) {
      push('DOC-MISS', `${d.id} 状态 ${d.status} 但路径不存在：${d.path}`)
    }
    if (d.status === 'external' && d.external !== true && !exists(d.path)) {
      push('DOC-MISS', `${d.id} 为 external 且未豁免本机检查，但路径不存在：${d.path}`)
    }
  }

  const registered = new Set(docs.map((d) => d.path.replace(/\\/g, '/')))
  for (const t of trackedUnderActiveDirs) {
    if (!registered.has(t)) push('DOC-UNREG', `三层目录下存在未登记文档：${t}`)
  }

  // ── 2. 单一事实源（facts） ─────────────────────────────────────────
  const factIds = new Set()
  for (const f of facts) {
    if (!f.id) push('FACT-ID', '存在无 id 的事实登记')
    else if (factIds.has(f.id)) push('FACT-ID', `事实 id 重复：${f.id}`)
    else factIds.add(f.id)

    const auth = f.authority || {}
    if (auth.kind === 'doc') {
      if (!byId.has(auth.ref)) push('FACT-AUTH', `${f.id} 权威文档未登记：${auth.ref}`)
    } else if (auth.kind === 'code') {
      const p = String(auth.ref).split('#')[0]
      if (!exists(p)) push('FACT-AUTH', `${f.id} 权威路径不存在：${auth.ref}`)
    } else {
      push('FACT-AUTH', `${f.id} 缺 authority.kind/ref`)
    }

    const derived = f.derived || []
    for (const d of derived) {
      if (!d.site) push('FACT-SITE', `${f.id} 派生点缺 site`)
      if (!d.guard) push('FACT-GUARD', `${f.id} 派生点无守卫（半覆盖）：${d.site}`)
      else if (!exists(d.guard)) push('FACT-GUARD', `${f.id} 派生点守卫不存在：${d.guard}`)
    }
    if (!f.guard) push('FACT-GUARD', `${f.id} 缺总守卫`)
    else if (!exists(f.guard)) push('FACT-GUARD', `${f.id} 总守卫不存在：${f.guard}`)
  }

  // ── 3. 读写矩阵：AGENTS §二 ↔ tasks[] ──────────────────────────────
  const rowRe = /^\|\s*([A-F]′?)(?![0-9A-Za-z])[^|]*\|(.+)$/gm
  const rows = new Map()
  for (const m of agentsText.matchAll(rowRe)) rows.set(m[1], m[2])
  const taskIds = new Set(tasks.map((t) => t.id))
  for (const t of tasks) {
    const row = rows.get(t.id)
    if (!row) {
      push('TASK-ROW', `AGENTS 矩阵缺任务行：${t.id}`)
      continue
    }
    for (const id of [...(t.read || []), ...(t.writeBack || [])]) {
      if (!byId.has(id)) push('TASK-REF', `任务 ${t.id} 引用未登记目标：${id}`)
      if (!row.includes(id)) push('TASK-ROW', `AGENTS 任务行 ${t.id} 未包含目标 ${id}`)
    }
  }
  for (const id of rows.keys()) {
    if (!taskIds.has(id)) push('TASK-ROW', `AGENTS 矩阵多出未登记任务：${id}`)
  }

  // ── 4. 契约时间戳与变更记录 ────────────────────────────────────────
  for (const d of docs) {
    if (d.layer !== '契约' || d.status !== 'active' || d.path.endsWith('/')) continue
    const text = readText(d.path)
    if (text == null) {
      push('CONTRACT-TEXT', `${d.id} 契约不可读：${d.path}`)
      continue
    }
    const revisit = text.match(/最近复核[：:]\s*(\d{4}-\d{2}-\d{2})/)
    if (!revisit) push('CONTRACT-DATE', `${d.id} 缺「最近复核：YYYY-MM-DD」`)
    const logIdx = text.indexOf('## 变更记录')
    if (logIdx < 0) {
      push('CONTRACT-LOG', `${d.id} 缺「## 变更记录」段`)
    } else {
      const dates = [...text.slice(logIdx).matchAll(/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]).sort()
      if (!dates.length) push('CONTRACT-LOG', `${d.id} 变更记录无日期条目`)
      else {
        const commit = gitDate(d.path)
        if (commit && dates.at(-1) < commit) {
          push('CONTRACT-LOG', `${d.id} 变更记录最新 ${dates.at(-1)} 早于最后提交日 ${commit}`)
        }
      }
    }
    if (d.generatedFrom) {
      const srcDate = gitDate(d.generatedFrom)
      const ownDate = gitDate(d.path)
      if (srcDate && ownDate && srcDate > ownDate) {
        push(
          'CONTRACT-STALE',
          `${d.id} 生成件落后于源：${d.generatedFrom} 提交于 ${srcDate} > ${ownDate}`
        )
      }
    }
  }

  // ── 5. 日志时间戳 ─────────────────────────────────────────────────
  for (const d of docs) {
    if (d.layer !== '日志' || d.status === 'retired') continue
    if (d.ts) continue
    if (/\d{4}-\d{2}-\d{2}/.test(path.basename(d.path))) continue
    if (d.path.endsWith('/')) {
      push('LOG-TS', `${d.id} 日志目录无时间戳字段`)
      continue
    }
    const text = readText(d.path)
    const head = text ? text.split(/\r?\n/).slice(0, 60).join('\n') : ''
    if (!/\d{4}-\d{2}-\d{2}/.test(head))
      push('LOG-TS', `${d.id} 日志无时间戳（文件名/头部/登记 ts 三者皆无）`)
  }

  // ── 6. KP 迁移表 ──────────────────────────────────────────────────
  if (!kp) {
    push('KP-MISS', `${KP_MAP_PATH} 缺失：迁移期没有权威切换口径`)
  } else {
    const kpIds = new Set()
    const covered = new Map()
    const anchorTargets = new Map()
    for (const k of kp.kps || []) {
      if (!k.id || kpIds.has(k.id)) push('KP-ID', `KP id 缺失或重复：${k.id}`)
      else kpIds.add(k.id)

      const srcKey = `${k.source}|${k.anchor}`
      if (!covered.has(k.source)) covered.set(k.source, new Set())
      covered.get(k.source).add(srcKey)

      if (!k.target || !byId.has(k.target)) {
        push('KP-TARGET', `${k.id} 目标未登记：${k.target}`)
      } else {
        const t = byId.get(k.target)
        if (k.authority === 'new' && t.status !== 'active') {
          push('KP-AUTH', `${k.id} 标 new 但目标 ${k.target} 状态为 ${t.status}`)
        }
      }
      if (!['old', 'new'].includes(k.authority))
        push('KP-AUTH', `${k.id} authority 非法：${k.authority}`)

      const key = srcKey
      if (!anchorTargets.has(key)) anchorTargets.set(key, new Set())
      anchorTargets.get(key).add(k.target)
    }
    for (const [key, targets] of anchorTargets) {
      if (targets.size > 1)
        push('KP-DUAL', `${key} 同时指向多个目标（双权威）：${[...targets].join('、')}`)
    }
    for (const s of kp.sources || []) {
      if (!exists(s.file)) {
        push('KP-SRC', `KP 源文件不存在：${s.file}`)
        continue
      }
      for (const sec of s.sections || []) {
        if (!covered.get(s.id)?.has(`${s.id}|${sec.anchor}`)) {
          push('KP-COVER', `${s.file} 的「${sec.heading}」(${sec.anchor}) 无 KP 覆盖`)
        }
      }
    }
  }

  // ── 7. 迁移闸门：声明结束后不许留 stub/planned ─────────────────────
  if (meta.migrationOpen === false) {
    for (const d of docs) {
      if (d.status === 'stub' || d.status === 'planned') {
        push('MIG-OPEN', `迁移已声明结束但仍有 ${d.status}：${d.id}`)
      }
    }
  }

  return problems
}

/** 读取受版本控制的三层目录文件列表（git 不可用 ⇒ 记空并单独报） */
function trackedUnderDirs() {
  try {
    const out = execFileSync('git', ['ls-files', ...ACTIVE_DIRS], { cwd: ROOT, encoding: 'utf8' })
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((p) => p.replace(/\\/g, '/'))
  } catch {
    return null
  }
}

function gitDateOf(rel) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', rel], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    return out.trim() || null
  } catch {
    return null
  }
}

function main() {
  const json = process.argv.includes('--json')
  const mapPath = path.join(ROOT, DOC_MAP_PATH)
  const kpPath = path.join(ROOT, KP_MAP_PATH)
  const collect = (absent) => {
    const input = {
      docs: [],
      facts: [],
      tasks: [],
      kp: null,
      meta: {},
      agentsText: '',
      trackedUnderActiveDirs: [],
      exists: (rel) => fs.existsSync(path.isAbsolute(rel) ? rel : path.join(ROOT, rel)),
      gitDate: gitDateOf,
      readText: (rel) => {
        try {
          return fs.readFileSync(path.join(ROOT, rel), 'utf8')
        } catch {
          return null
        }
      },
    }
    if (absent.includes(DOC_MAP_PATH)) return { ...input, missing: DOC_MAP_PATH }
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'))
    input.docs = map.docs || []
    input.facts = map.facts || []
    input.tasks = map.tasks || []
    input.meta = map.meta || {}
    input.agentsText = input.readText('AGENTS.md') || ''
    input.trackedUnderActiveDirs = trackedUnderDirs() || []
    if (!absent.includes(KP_MAP_PATH) && fs.existsSync(kpPath)) {
      input.kp = JSON.parse(fs.readFileSync(kpPath, 'utf8'))
    }
    return input
  }

  const missing = []
  if (!fs.existsSync(mapPath)) missing.push(DOC_MAP_PATH)
  if (!fs.existsSync(kpPath)) missing.push(KP_MAP_PATH)
  if (missing.includes(DOC_MAP_PATH)) {
    console.error(`[doc-map-check] FAIL：登记表缺失 ${DOC_MAP_PATH}`)
    process.exit(1)
  }
  const problems = auditDocMap(collect(missing))
  if (json) {
    console.log(JSON.stringify({ problems }, null, 1))
  } else if (problems.length) {
    console.error(`[doc-map-check] FAIL：${problems.length} 处`)
    for (const p of problems) console.error(`  - [${p.code}] ${p.msg}`)
  } else {
    const input = collect(missing)
    const active = input.docs.filter((d) => d.status === 'active').length
    const planned = input.docs.filter((d) => d.status === 'planned' || d.status === 'stub').length
    console.log(
      `[doc-map-check] OK：登记 ${input.docs.length} 件（active ${active} / 待迁移 ${planned}）；矩阵 ${input.tasks.length} 项；KP ${input.kp?.kps?.length ?? 0} 条`
    )
  }
  process.exit(problems.length ? 1 : 0)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
