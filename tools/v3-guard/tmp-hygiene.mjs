#!/usr/bin/env node
/**
 * tmp-hygiene.mjs — 临时文件卫生守卫（第 5 个 v3 守卫）。
 *
 * 背景：调试与 agent 会话会在仓库根目录、docs/、tools/ 等受控目录落下临时文件
 * （.tmp-*、*.bak、~$xxx、一次性截图/脚本）。这些残渣污染目录，且因未入库而无人清理，
 * 每次整理都要重新"考古"。
 *
 * 约定（唯一落点：.local/，见 .local/README.md）：
 *   - 临时文件  → .local/tmp/    （npm run tmp:clean 清空）
 *   - 待删暂存  → .local/trash/
 *   - agent 文档 → .local/agent-docs/
 *
 * 断言：受控目录（下列目录的**一级条目**）内不得出现临时文件/临时目录命名模式。
 * 只扫一级是有意为之：源码树内的一级文件本就应是受控资产，深层目录由
 * structure-check.mjs 等其他守卫负责。
 *
 * ⚠️ 2026-09-18 审计 D-04 修正：原实现 `if (!e.isFile()) continue` 直接跳过所有目录，
 * 于是 `tmp-out/`、`tmp-archive/`、`tmp-pinglu/` 这类**以临时前缀命名的目录**（当时根目录
 * 三个、含 496 个文件）对守卫完全不可见 ⇒ 守卫恒真（每次都 OK）。守卫自己成了摆设。
 * 修法：一级条目不再区分 file/dir，目录同样参与命名匹配——这仍只需一次 readdir，
 * 不引入递归开销，却把「一级就看得见的残渣」全部纳入。
 * 目录命中时额外标注条目类型与（浅层）内容规模，便于判断是否可直接搬走。
 *
 * 用法：
 *   node tools/v3-guard/tmp-hygiene.mjs              # 扫描（违规 exit 1）
 *   node tools/v3-guard/tmp-hygiene.mjs --json       # 机器可读输出
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 受控目录：只检查一级条目 */
const WATCHED = ['.', 'docs', 'tools', 'scripts', 'backend', 'frontend']

/** 临时文件命名模式（命中即违规） */
const TEMP_PATTERNS = [
  { re: /^\.tmp[-_.]/, why: '临时文件前缀 .tmp-' },
  { re: /\.(tmp|bak|orig|swp|swo|old)$/i, why: '临时/备份扩展名' },
  { re: /^~[$~]?/, why: 'Office/WPS 锁文件' },
  { re: /^(scratch|debug-|draft-|try-|temp[-_.])/i, why: '草稿命名前缀' },
  { re: /^(screenshot|截图)[-_.]?.*\.(png|jpe?g|webp)$/i, why: '一次性截图' },
  // 目录专用的临时命名（原实现因跳过目录而从未生效）
  { re: /^tmp[-_.]/, why: '临时目录前缀 tmp-（目录级残渣）' },
]

/** 合法长驻文件（历史约定，不是残渣） */
const ALLOWED = new Set(['.eslintcache', '.tmp-hygiene.json'])

/**
 * 合法长驻**目录**处理规则（显式判定，避免用「模糊豁免」把守卫再度削成摆设）。
 *
 * 判定原则（2026-09-18 定）：`tmp-` 前缀目录本身是**根目录污染**——但若它已经被
 * .gitignore 明确忽略（见 .gitignore 中 `tmp-` 通配那条），则它属于「本机会话工作区」，
 * 不是「待清理的残渣」：既不入库、也不进 prettier 门禁，清理由用户按需执行。
 * 这类目录豁免；反之**未被忽略的 tmp- 目录必须报红**（那才是真正的结构污染）。
 *
 * 实现上不硬编码目录名，而是查 git 忽略状态——这样新增本机工作区无需改守卫，
 * 而「悄悄在根目录建个 tmp-xxx 且忘了忽略」仍会被抓。
 *
 * ⚠️ **本规则的强度边界（诚实记录，勿高估）**：因为 .gitignore 里已有 `tmp-` 通配那条，
 * 现行策略下**几乎所有 tmp- 目录都会被自动豁免**，故「目录命中」在正常情况下不会触发。
 * 它真正的价值是**兜住「.gitignore 尚未覆盖的命名」**（例如 `.tmp-x` 这类点前缀目录、
 * 或将来有人删掉那条通配），以及在**非 git 环境**（tarball 分发）下仍然报红。
 * 换言之：本守卫对**文件**是强约束，对**目录**是弱约束——不要把它当作「根目录没有
 * tmp- 目录」的保证；那是 .gitignore 与人工整理的责任。
 *
 * ⚠️ 别在本注释里写「星号加斜杠」的 glob 字面量：它会提前闭合 JSDoc（2026-09-18 踩中，
 * 直接导致 SyntaxError）。
 */
function isGitIgnored(absPath) {
  try {
    const r = spawnSync('git', ['-C', ROOT, 'check-ignore', '-q', absPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // check-ignore: 0 = 被忽略；1 = 未被忽略；128 = 非 git 环境
    if (r.status === 0) return true
    if (r.status === 1) return false
    return null // 非 git 环境：无法判定
  } catch {
    return null
  }
}

/** 统计目录一级条目数（仅用于报告可读性，不递归） */
function shallowCount(dir) {
  try {
    return readdirSync(dir).length
  } catch {
    return null
  }
}

function scan() {
  const hits = []
  for (const rel of WATCHED) {
    const dir = path.join(ROOT, rel)
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue // 目录不存在（如未安装子项目）则跳过
    }
    for (const e of entries) {
      if (ALLOWED.has(e.name)) continue
      const hit = TEMP_PATTERNS.find((p) => p.re.test(e.name))
      if (!hit) continue
      const isDir = e.isDirectory()
      const abs = path.join(dir, e.name)
      // 目录级残渣：已被 .gitignore 忽略 ⇒ 视为本机会话工作区，豁免；
      // 未被忽略（或非 git 环境无法判定）⇒ 报红。
      if (isDir && isGitIgnored(abs) === true) continue
      const count = isDir ? shallowCount(abs) : null
      hits.push({
        dir: rel === '.' ? '(仓库根)' : rel + '/',
        name: e.name,
        type: isDir ? 'dir' : 'file',
        why: hit.why,
        ...(count !== null ? { shallowEntries: count } : {}),
      })
    }
  }
  return hits
}

const hits = scan()

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ hits }, null, 2))
  process.exit(hits.length ? 1 : 0)
}

if (hits.length > 0) {
  console.log(`[tmp-hygiene] ${hits.length} 个临时条目残留在受控目录：`)
  for (const h of hits) {
    const kind = h.type === 'dir' ? '目录' : '文件'
    // ⚠️ 必须用 `!= null`（同时排除 null 与 undefined）：文件条目的 shallowEntries 是
    // null，若用 `!== null` 判定，展开后仍会带上 undefined 而打印「一级含 undefined 项」。
    const extra = h.shallowEntries != null ? `，一级含 ${h.shallowEntries} 项` : ''
    console.log(`  - ${h.dir}${h.name}（${kind}${extra}；${h.why}）`)
  }
  console.log('处理：移动到 .local/tmp/（待删则 .local/trash/），或 npm run tmp:clean 清理。')
  process.exit(1)
}
console.log(`[tmp-hygiene] OK：${WATCHED.length} 个受控目录无临时文件/目录残留`)
