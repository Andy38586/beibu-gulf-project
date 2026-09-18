#!/usr/bin/env node
/**
 * test-watchdog.cjs — 测试「是否真的形成约束」的动态看门狗（EP-DYN，2026-09-15）
 *
 * 解决两类「测试是松的 / 外壳直接放行」：
 *
 *  1) 静默 skip = 绿。后端 12 个真库套件用 describe.skipIf(!withDb) 门控：
 *     本地 pre-push 不设 V3_INTEGRATION_DB 时 468 个用例有 116 个被跳过、进程却 exit 0，
 *     「116 跳过的绿」和「468 真跑的绿」在退出码上无法区分；CI 一旦漏配 V3_INTEGRATION_DB，
 *     同样会整组沉睡还报绿。本器消费 vitest 的 JSON 结果，按「放行白名单 + 理由 + 上限」治理：
 *       · mode=gated：仅当门控环境变量【缺失】时（本地无库）允许跳过；该变量一旦【存在】（CI 承诺真库），
 *         这些文件里再出现任何跳过即判失败——承诺要跑的就必须真跑。
 *         门控变量默认取项目级 requireEnvToRunGated，**可用条目级 `env` 覆盖**——因为门控条件必须
 *         与该文件的实际依赖对齐（2026-09-15 实测教训）：
 *           - `backend/test/route.e2e-spec.ts` 的夹具用例依赖 CI 合成夹具图
 *             （`backend/test/seed/roads-graph-fixture.sql`，seed 明令禁止灌真库）
 *             ⇒ 声明 `"env": "V3_ROADS_FIXTURE"`，本地真库下允许跳过、CI 装了夹具则必须真跑；
 *           - 全量真实数据快照类断言（如 `site-analysis.e2e-spec.ts` 的 TOP1 名称/分数）
 *             同理声明 `"env": "V3_FULL_DATASET"`。
 *           沿用项目级变量会让这两类套件「本地有真库时该跑却必然失败 / CI 里承诺了却沉睡」。
 *       · mode=data ：数据依赖型跳过（如 plans.json 不入库），始终允许但设上限 max，超出即失败。
 *       · 白名单之外的任何跳过 = 未申报的静默跳过，一律失败（新增 .skip 必须显式登记理由）。
 *
 *  2) 「清单存在 ≠ 被执行」。磁盘上匹配 include 的测试文件，必须在本次结果里真实出现且至少收集到 1 个用例：
 *     文件被改名/掉出 glob/收集期 import 崩了，都会让它「看起来还在、其实没跑」→ 判失败。
 *
 *  另含 --static 静态补刀：精确识别空壳用例 it('x', () => {})（有标题无断言、跑了等于没跑）。
 *
 * 设计与 coverage-ratchet 一致：判定逻辑全部抽成纯函数（便于注入测试），CLI 只做读写与退出码；
 * 不依赖任何第三方包。
 *
 * 用法：
 *   node scripts/test-watchdog.cjs                      # 读 test-gate.config.json，校验全部项目
 *   node scripts/test-watchdog.cjs --project backend    # 只校验一个项目
 *   node scripts/test-watchdog.cjs --static             # 追加空壳用例静态扫描
 *   node scripts/test-watchdog.cjs --config <path> --result <覆盖结果路径>
 *
 * 退出码：0 = 无违规（允许的跳过会显式列出，绝不静默）；1 = 存在违规。
 */
const fs = require('node:fs')
const path = require('node:path')

const SKIP_STATUSES = new Set(['pending', 'skipped', 'todo'])

// ---------- 路径工具 ----------
function toPosix(p) {
  return p.replace(/\\/g, '/')
}
function relTo(rootAbs, fileAbs) {
  return toPosix(path.relative(rootAbs, fileAbs))
}

// ---------- 极简 glob（支持 ** * ? 与 {a,b} 花括号，满足 vitest include 的表达需要）----------
/**
 * ⚠️ 花括号支持是 2026-09-18 补的（审计 D-05）：vitest 的 **默认 include** 是
 * `**\/*.{test,spec}.?(c|m)[jt]s?(x)` 这种带 {a,b} 与 ?(x) 的写法，原引擎把 `{` `}`
 * 当字面量 ⇒ 该模式匹配 0 个文件。后果比「漏报」更糟：用默认 include 当基准去比对时
 * 会得「零漂移」的假结论（2026-09-18 实测踩中——探针 glob 返回 0 命中）。
 *
 * 这里实现常用的子集：
 *   - `{a,b,c}` → `(?:a|b|c)`（不支持嵌套，够用）
 *   - `?(x)`    → `(?:x)?`（可选段）
 *   - `*` `**` `?` 语义同前
 * 不追求完整 minimatch 兼容——**只保证「本项目用到的模式」判定正确**，
 * 超出部分宁可当字面量也不要静默失配（静默失配正是要根除的失效模式）。
 */
function globToRegExp(glob) {
  let re = '^'
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '{') {
      const close = glob.indexOf('}', i)
      if (close > i) {
        const alts = glob
          .slice(i + 1, close)
          .split(',')
          .map((a) => a.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
        re += '(?:' + alts.join('|') + ')'
        i = close
        continue
      }
      re += '\\{'
    } else if (c === '?' && glob[i + 1] === '(') {
      // ?(pattern) —— 可选分组
      const close = glob.indexOf(')', i + 2)
      if (close > i) {
        const inner = glob.slice(i + 2, close)
        // 内层仅支持字符类（如 c|m）与字面量，按需转义
        const body = inner.includes('|')
          ? inner
              .split('|')
              .map((a) => a.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
              .join('|')
          : inner.replace(/[.+^${}()|[\]\\]/g, '\\$&')
        re += '(?:' + body + ')?'
        i = close
        continue
      }
      re += '\\?'
    } else if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++ // **/ 跨目录
      } else {
        re += '[^/]*'
      }
    } else if (c === '[') {
      // 字符类 [jt]、[cm] 等：整段透传（内容本身是合法正则字符类）
      const close = glob.indexOf(']', i)
      if (close > i) {
        re += glob.slice(i, close + 1)
        i = close
        continue
      }
      re += '\\['
    } else if ('.+^${}()|[]^\\'.includes(c)) {
      re += '\\' + c
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += c
    }
  }
  return new RegExp(re + '$')
}

function listTestFilesOnDisk(
  rootAbs,
  includeGlobs,
  ignoreDirs = ['node_modules', 'dist', 'coverage']
) {
  const matchers = includeGlobs.map(globToRegExp)
  const found = []
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (ignoreDirs.includes(e.name)) continue
        walk(path.join(dir, e.name))
      } else if (e.isFile()) {
        const rel = relTo(rootAbs, path.join(dir, e.name))
        if (matchers.some((m) => m.test(rel))) found.push(rel)
      }
    }
  }
  walk(rootAbs)
  return found.sort()
}

// ---------- 结果归一化 ----------
/**
 * 把 vitest JSON 结果整理成 { byFile: { relFile: { ran, total, skipped:[titles...], failed } }, totals }
 * @param {object} result vitest --reporter=json 产物
 * @param {string} rootAbs 项目根绝对路径（用于把 result 里的绝对路径转成相对键）
 */
function normalizeResult(result, rootAbs) {
  const byFile = {}
  for (const tr of result.testResults || []) {
    if (!tr || !tr.name) continue
    const file = relTo(rootAbs, path.resolve(tr.name))
    const assertions = tr.assertionResults || []
    const skipped = []
    let failed = 0
    for (const a of assertions) {
      if (SKIP_STATUSES.has(a.status)) skipped.push(a.fullName || a.title || '(unnamed)')
      if (a.status === 'failed') failed++
    }
    // 同一文件不会出现两次；防御性合并
    const prev = byFile[file] || { total: 0, skipped: [], failed: 0 }
    byFile[file] = {
      ran: true,
      total: prev.total + assertions.length,
      skipped: prev.skipped.concat(skipped),
      failed: prev.failed + failed,
    }
  }
  return {
    byFile,
    totals: {
      total: result.numTotalTests ?? 0,
      passed: result.numPassedTests ?? 0,
      skipped: result.numPendingTests ?? 0,
      failed: result.numFailedTests ?? 0,
    },
  }
}

// ---------- 核心纯判定 ----------
/**
 * 评估单个项目。
 * @param {object} project test-gate.config.json 里的单个 project 配置
 * @param {object} result 解析后的 vitest JSON
 * @param {object} ctx
 * @param {string} ctx.rootAbs 项目根绝对路径
 * @param {Record<string,string|undefined>} ctx.env 环境变量（默认 process.env）
 * @param {string[]} [ctx.filesOnDisk] 可注入：磁盘上的测试文件相对清单；不给则现场遍历
 * @param {string[]} [ctx.vitestFilesOnDisk] 可注入：按 vitest 侧 include 枚举的文件清单；不给则现场遍历
 * @returns {{ violations: Array<{code:string,file?:string,detail:string}>, allowedSkips: Array<{file:string,count:number,mode:string}>, ranFiles:number, diskFiles:number }}
 */
function evaluateProject(project, result, ctx) {
  const { rootAbs, env = process.env, filesOnDisk, vitestFilesOnDisk } = ctx
  const gatedEnv = project.requireEnvToRunGated
  const gatedEnvSet = gatedEnv ? env[gatedEnv] !== undefined : false
  const allow = project.allowSkipped || {}

  const disk =
    filesOnDisk ?? listTestFilesOnDisk(rootAbs, project.include || [], project.ignoreDirs)
  const norm = normalizeResult(result, rootAbs)
  const violations = []
  const allowedSkips = []

  // (0) include 漂移断言（审计 D-05，2026-09-18）：
  //     本器的「磁盘清单」来自 project.include，而 vitest 实际跑什么由它自己的 include/
  //     默认值决定。两者一旦漂移，本器的兜底就出现**结构性盲区**：
  //       - vitest 跑了但不在本器清单里的文件 ⇒ 它的跳过/空壳/失败全不被发现（漏网）
  //       - 本器清单有但 vitest 不跑 ⇒ 误报 TEST_FILE_NOT_RUN（噪声，会诱人放宽登记）
  //     漂移本身很难靠肉眼维持（vitest 默认 include 是 `**\/*.{test,spec}.?(c|m)[jt]s?(x)`，
  //     允许 js/jsx/mjs/cts 等一堆变体，而本器配置写的是窄的 *.ts）——2026-09-18 实测：
  //     当前恰好零漂移（58/58 命中），属**潜伏**风险：某人加一个 foo.test.js 即静默漏网。
  //     故显式声明 `vitestInclude`（vitest 侧真值）并逐条断言包含关系，漂移即报红。
  if (Array.isArray(project.vitestInclude) && project.vitestInclude.length > 0) {
    const vitestFiles =
      vitestFilesOnDisk ?? listTestFilesOnDisk(rootAbs, project.vitestInclude, project.ignoreDirs)
    const declared = new Set(disk)
    const uncovered = vitestFiles.filter((f) => !declared.has(f))
    if (uncovered.length > 0) {
      violations.push({
        code: 'INCLUDE_DRIFT',
        detail:
          `vitest 的 include 模式会执行 ${vitestFiles.length} 个文件，但本器 include 只覆盖 ${declared.size} 个——` +
          `差集 ${uncovered.length} 个文件处于**结构盲区**（其跳过/空壳/失败不会被本器发现）：\n` +
          uncovered
            .slice(0, 8)
            .map((f) => `      · ${f}`)
            .join('\n') +
          (uncovered.length > 8 ? `\n      …… 另有 ${uncovered.length - 8} 个` : '') +
          '\n    修法：把 test-gate.config.json 的 include 对齐 vitest 真实模式（勿只放宽本器清单）。',
      })
    }
  }

  // (a) 磁盘有、结果无 = 没被执行；结果有但 0 用例 = 空套件
  for (const file of disk) {
    const got = norm.byFile[file]
    if (!got) {
      violations.push({
        code: 'TEST_FILE_NOT_RUN',
        file,
        detail:
          '磁盘上存在该测试文件，但本次 vitest 结果里没有它（掉出 include / 收集期报错 / 改名未跑）',
      })
    } else if (got.total === 0) {
      violations.push({
        code: 'EMPTY_SUITE',
        file,
        detail: '该文件被收集但 0 个用例（describe/it 全被注释或条件为假）',
      })
    }
  }

  // (b) 逐文件治理跳过
  for (const [file, info] of Object.entries(norm.byFile)) {
    if (info.failed > 0) {
      violations.push({ code: 'RESULT_FAILED_TESTS', file, detail: `${info.failed} 个用例失败` })
    }
    if (info.skipped.length === 0) continue

    const rule = allow[file]
    if (!rule) {
      violations.push({
        code: 'UNDECLARED_SKIP',
        file,
        detail:
          `${info.skipped.length} 个用例被跳过但未在 test-gate.config.json 登记：` +
          info.skipped.slice(0, 3).join('；') +
          (info.skipped.length > 3 ? ` 等 ${info.skipped.length} 条` : ''),
      })
      continue
    }

    if (rule.mode === 'gated') {
      // 每文件可用 rule.env 覆盖项目级门控变量：**门控条件必须与该文件的实际依赖对齐**。
      // 动机（2026-09-15 实测）：route.e2e-spec 中两条用例断言的是 CI 合成夹具图
      //（backend/test/seed/roads-graph-fixture.sql），本地真库上不可能满足——若沿用
      // 项目级 V3_INTEGRATION_DB，则"本地有真库 → 该文件该跑却必然失败"。
      // 故允许逐文件声明自己的门控变量（如 V3_ROADS_FIXTURE / V3_FULL_DATASET），
      // 语义不变：该变量一旦设置，本文件的任何跳过仍判违规（承诺要跑的必须真跑）。
      const ruleEnv = rule.env || gatedEnv
      const ruleEnvSet = ruleEnv ? env[ruleEnv] !== undefined : false
      if (ruleEnvSet) {
        violations.push({
          code: 'GATED_SKIP_IN_REQUIRED_ENV',
          file,
          detail:
            `已设置 ${ruleEnv}（承诺本文件依赖就绪），该门控文件却仍有 ${info.skipped.length} 个用例跳过：` +
            '依赖没就绪或门控条件写错——承诺要跑的必须真跑，不得沉睡报绿',
        })
      } else {
        allowedSkips.push({ file, count: info.skipped.length, mode: 'gated', env: ruleEnv })
      }
    } else if (rule.mode === 'data') {
      const cap = typeof rule.max === 'number' ? rule.max : Infinity
      if (info.skipped.length > cap) {
        violations.push({
          code: 'DATA_SKIP_OVER_CAP',
          file,
          detail: `数据依赖跳过 ${info.skipped.length} 条 > 登记上限 ${cap}（${rule.reason || '未写理由'}）`,
        })
      } else {
        allowedSkips.push({ file, count: info.skipped.length, mode: 'data' })
      }
    } else {
      violations.push({
        code: 'BAD_ALLOW_MODE',
        file,
        detail: `白名单 mode 必须是 gated/data，收到 ${JSON.stringify(rule.mode)}`,
      })
    }
  }

  return {
    violations,
    allowedSkips,
    ranFiles: Object.keys(norm.byFile).length,
    diskFiles: disk.length,
    totals: norm.totals,
    gatedEnvSet,
  }
}

// ---------- 空壳用例静态扫描（--static）----------
/**
 * 识别「有 it/test 标题、回调体为空（或仅注释）」的空壳用例。
 * 保守实现：只命中 () => {} / function(){} 体内无任何语句的形态，辅助函数断言不算。
 * @returns {Array<{file:string,line:number,title:string}>}
 */
function findEmptyTestBlocks(source) {
  const out = []
  // it( / test( 起手，找到回调箭头/function 的第一层 { }，判断其间是否为空
  const re = /(?:^|[^.\w])(?:it|test)\s*\(\s*[`'"]([^`'"]*)[`'"]\s*,/g
  let m
  while ((m = re.exec(source))) {
    const title = m[1]
    const after = source.slice(m.index + m[0].length)
    const braceAt = after.search(/\{/)
    // 回调必须在很近的位置出现（避免把链式误判）
    const head = after.slice(0, braceAt + 1)
    if (!/=>|function/.test(head)) continue
    if (braceAt < 0 || braceAt > 120) continue
    let depth = 0
    let body = ''
    let end = -1
    for (let i = braceAt; i < after.length; i++) {
      const ch = after[i]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
      if (depth >= 1) body += ch
    }
    if (end === -1) continue
    const meaningful = body
      .replace(/[{}]/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/g, '')
      .trim()
    if (meaningful === '') {
      const line = source.slice(0, m.index).split('\n').length
      out.push({ line, title })
    }
  }
  return out
}

// ---------- CLI ----------
function parseArgs(argv) {
  const get = (k, d) => {
    const i = argv.indexOf(k)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d
  }
  return {
    config: get('--config', path.resolve(__dirname, '..', 'scripts', 'test-gate.config.json')),
    project: get('--project', null),
    resultOverride: get('--result', null),
    isStatic: argv.includes('--static'),
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const repoRoot = path.resolve(__dirname, '..')

  let config
  try {
    config = JSON.parse(fs.readFileSync(args.config, 'utf8'))
  } catch (e) {
    console.error(`::error::无法读取门禁配置 ${args.config}：${e.message}`)
    process.exit(1)
  }

  const names = args.project ? [args.project] : Object.keys(config.projects || {})
  let totalViolations = 0
  let totalAllowedSkips = 0

  for (const name of names) {
    const project = (config.projects || {})[name]
    if (!project) {
      console.error(`::error::配置里没有项目 "${name}"`)
      process.exit(1)
    }
    const rootAbs = path.resolve(repoRoot, project.root)
    const resultPath = args.resultOverride
      ? path.resolve(repoRoot, args.resultOverride)
      : path.resolve(repoRoot, project.result)

    console.log(`\n[watchdog] 项目 ${name}（结果：${path.relative(repoRoot, resultPath)}）`)
    let result
    try {
      result = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
    } catch (e) {
      console.error(
        `::error::读不到 ${name} 的 vitest JSON 结果（${path.relative(repoRoot, resultPath)}）。\n` +
          '  请先以 `vitest run --reporter=json --outputFile=<该路径>` 跑测试再看门控；没有结果文件不允许视为通过。'
      )
      totalViolations++
      continue
    }

    const report = evaluateProject(project, result, { rootAbs, env: process.env })
    const t = report.totals
    console.log(
      `  用例 ${t.total}：通过 ${t.passed} · 跳过 ${t.skipped} · 失败 ${t.failed}；` +
        `磁盘测试文件 ${report.diskFiles}，实际执行 ${report.ranFiles}` +
        (project.requireEnvToRunGated
          ? `（门控变量 ${project.requireEnvToRunGated} ${report.gatedEnvSet ? '已设置→门控套件必须真跑' : '未设置→门控套件允许本地跳过'}）`
          : '')
    )
    for (const a of report.allowedSkips) {
      totalAllowedSkips += a.count
      const rule = project.allowSkipped[a.file]
      console.log(
        `  · 已登记跳过 ${a.count} 条 [${a.mode}] ${a.file}` +
          (rule?.reason ? ` — ${rule.reason}` : '')
      )
    }
    for (const v of report.violations) {
      totalViolations++
      console.error(`  ::error::[${v.code}] ${v.file ? v.file + '：' : ''}${v.detail}`)
    }

    if (args.isStatic) {
      const files = listTestFilesOnDisk(rootAbs, project.include || [], project.ignoreDirs)
      for (const f of files) {
        const src = fs.readFileSync(path.join(rootAbs, f), 'utf8')
        for (const empty of findEmptyTestBlocks(src)) {
          totalViolations++
          console.error(
            `  ::error::[EMPTY_TEST] ${f}:${empty.line} 空壳用例「${empty.title}」——有标题无断言，跑了等于没跑，请补断言或删除`
          )
        }
      }
    }
  }

  console.log('')
  if (totalViolations > 0) {
    console.error(
      `[watchdog] ✗ 发现 ${totalViolations} 处违规：测试没有真正形成约束（未申报跳过 / 承诺要跑却沉睡 / 用例没被执行 / 空壳）。`
    )
    process.exit(1)
  }
  console.log(
    `[watchdog] ✓ 门控通过：所有应跑用例均真实执行；${totalAllowedSkips} 条跳过均为已登记、有界、带理由的容错（明细见上，非静默）。`
  )
  process.exit(0)
}

module.exports = {
  toPosix,
  globToRegExp,
  listTestFilesOnDisk,
  normalizeResult,
  evaluateProject,
  findEmptyTestBlocks,
}

if (require.main === module) {
  main()
}
