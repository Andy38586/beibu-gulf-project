#!/usr/bin/env node
/**
 * 覆盖率棘轮（CI-CD 审查 C5）：以基线文件比较取代全局固定阈值——
 * 大版本迭代源码分母暴涨时，固定百分比阈值"第一次 CI 必红"的机制性追尾被根除；
 * 棘轮只拦"相对基线的实质回退"，覆盖率增长由 --update 写回基线（只升不降语义见下）。
 *
 * 用法:
 *   node scripts/coverage-ratchet.cjs <coverage-summary.json> <baseline.json>          # CI 检查模式
 *   node scripts/coverage-ratchet.cjs <coverage-summary.json> <baseline.json> --update # 本地写回模式
 *
 * coverage-summary.json 为 vitest --coverage (provider=v8, reporter 含 json-summary) 产物，
 * 形如 { total: { lines: {pct}, statements: {...}, functions: {...}, branches: {...} } }。
 *
 * 判定（TOLERANCE = 0.5pt，容差吸收平台/顺序差异）：
 *   检查模式：任一指标 < 基线 - 0.5 → exit 1（并列出回退项）；否则 exit 0
 *   写回模式：先按检查模式判定，通过后把基线更新为"逐项 max(基线, 本次)"——
 *            只接受增长，不接受"本次略高但彼项回退"的混合态整体覆写
 */
const fs = require('node:fs')
const path = require('node:path')

const TOLERANCE = 0.5
const METRICS = ['lines', 'functions', 'branches', 'statements']

const [, , summaryPath, baselinePath, flag] = process.argv

// ── 基线冻结校验（--freeze-check，2026-09-18 CI 审计 D-03）──────────────────
// 动机：棘轮的强度取决于「基线文件本身不被随手改动」。原实现只有两条护栏——
// ① CI 不带 --update（不能写盘）② 基线不可读/损坏即报错。
// 但这**拦不住**「本地跑 ci:local → --update 把基线抬高 → 连同提交」这条路径：
// 棘轮「只升不降」⇒ 基线一被抬高，此后低覆盖率也能过，门禁被静默钝化。
// 本模式用 git 判定「工作区基线与 HEAD 提交版本是否一致」。
//
// ⚠️ 本模式**不需要 coverage-summary**，故必须在下方 summary 参数校验之前分流——
//    否则调用方还得为一个与覆盖率无关的检查伪造 summary 路径。
//    参数形状不同：`--freeze-check <baseline.json>`（只需基线），
//    而检查模式是 `<summary> <baseline> [--update]`。故此处按「--freeze-check 出现的位置」取值。
if (process.argv.includes('--freeze-check')) {
  const fcIdx = process.argv.indexOf('--freeze-check')
  const fcBaseline = process.argv[fcIdx + 1]
  if (!fcBaseline) {
    console.error('用法: node scripts/coverage-ratchet.cjs --freeze-check <baseline.json>')
    process.exit(2)
  }
  const { execFileSync, spawnSync } = require('node:child_process')
  const repoRoot = path.resolve(__dirname, '..')
  // ⚠️ 相对路径解析基准 = **cwd 优先**（CLI 直觉），不存在时再退回 repoRoot。
  // 历史坑：先前一律以 repoRoot 为基准，导致 `cd frontend && node ../scripts/... --freeze-check
  // coverage-baseline.json` 被解析成 `<repo>/coverage-baseline.json`（不存在）而不是
  // `<repo>/frontend/coverage-baseline.json`；更糟的是 ENOENT 被吞进 GIT_UNAVAILABLE
  // ⇒ **exit 0 假绿**（2026-09-18 实测）。cwd 优先消除了这个歧义。
  // 绝对路径照旧（path.resolve 直接返回）。
  const freezeBaselineFile = path.isAbsolute(fcBaseline)
    ? fcBaseline
    : ([path.resolve(process.cwd(), fcBaseline), path.resolve(repoRoot, fcBaseline)].find((p) =>
        fs.existsSync(p)
      ) ?? path.resolve(process.cwd(), fcBaseline))

  // ⚠️ **仓库归属必须从「基线文件所在目录」反查，不能假定 = 脚本所在仓库**。
  // 2026-09-18 自测发现：硬用脚本 repoRoot 时，任何位于**别的** git 仓库里的基线
  // （测试 fixture、子模块、外边仓）都会被算成 `../../...` 这种仓库外相对路径，
  // git show 必 fatal → 又被吞进 GIT_UNAVAILABLE → exit 0 **假绿**。
  // 这正是本模式要根治的缺陷类型（「检查存在但永远不生效」），不能自己再犯一遍。
  //
  // ⚠️ Windows 陷阱（实测踩中）：git 返回的是正斜杠路径，且 **8.3 短名**与 Node 的
  // long path 可能不一致（`C:\Users\JIONHA~1\AppData\...` vs `C:\Users\JionHappY\...`），
  // 直接用 path.relative 会算出 `../../..` 这种仓库外相对路径 → git show 又 fatal。
  // 故两侧都过 fs.realpathSync 归一（短名/长名、大小写、符号链接一次解决）。
  const realOr = (p) => {
    try {
      return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p)
    } catch {
      return p
    }
  }
  let ownRoot = null
  try {
    const top = spawnSync(
      'git',
      ['-C', path.dirname(freezeBaselineFile), 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
    if (top.status === 0) ownRoot = realOr(top.stdout.trim())
  } catch {
    /* spawn 本身失败（git 不在 PATH）：ownRoot 保持 null，下方按 GIT_UNAVAILABLE 降级 */
  }

  const relPath = ownRoot
    ? path.relative(ownRoot, realOr(freezeBaselineFile)).replace(/\\/g, '/')
    : path.relative(repoRoot, realOr(freezeBaselineFile)).replace(/\\/g, '/')

  let verdict = 'UNKNOWN'
  let detail = ''
  let headObj = null
  let workObj = null
  let workRaw = null

  // 先判定「基线是否真的没有 HEAD 锚点」，这属于 DRIFT（fail-closed）而非环境限制。
  // 两种子情形都必须报红，且**不能靠 stderr 文案猜**（git 的报错文案随版本变动，
  // 而且「无提交的仓库」给出的是 `invalid object name 'HEAD'`、「有提交但文件未跟踪」
  // 给出的是 `path ... does not exist in 'HEAD'`——文案判据是脆的）：
  //   ① 仓库无任何提交（HEAD 不可解析）⇒ 基线根本无从冻结
  //   ② 仓库有提交但该文件不在 HEAD 树中 ⇒ 用未审阅的基线替换现有基线
  // 用 `rev-parse --verify HEAD` 与 `ls-tree` 显式探测，比匹配报错文案稳。
  let hasHead = false
  let trackedInHead = false
  if (ownRoot) {
    const rv = spawnSync('git', ['-C', ownRoot, 'rev-parse', '--verify', '--quiet', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    hasHead = rv.status === 0
    if (hasHead) {
      const ls = spawnSync(
        'git',
        ['-C', ownRoot, 'ls-tree', '--name-only', 'HEAD', '--', relPath],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      )
      trackedInHead = ls.status === 0 && ls.stdout.trim().length > 0
    }
  }

  try {
    workRaw = fs.readFileSync(freezeBaselineFile, 'utf8')
    try {
      workObj = JSON.parse(workRaw)
    } catch {
      /* 工作区基线本身不可解析：归入 DRIFT 分支报出（下方 JSON 比对会跳过） */
    }
    if (!ownRoot) {
      // 基线所在目录不属于任何 git 仓库 ⇒ 真的无法比对，走降级
      verdict = 'GIT_UNAVAILABLE'
      detail = 'ENOTGIT（基线所在目录不在任何 git 仓库内）'
    } else if (!hasHead) {
      // 仓库无提交：基线没有任何可冻结的锚点。这是**结构性**问题（不能用 git 校验），
      // 但性质是「检查无法建立」而不是「基线被改写」——仍按 DRIFT fail-closed 报红，
      // 因为静默放行会让「init 一个空仓」成为绕过冻结校验的路径。
      verdict = 'DRIFT'
      detail = 'NO_HEAD（基线所在仓库尚无任何提交，基线无冻结锚点）'
    } else if (!trackedInHead) {
      // 有提交但基线未被 HEAD 跟踪：等价于「棘轮无锚点」，放过它 = 允许用未提交基线替换现有基线
      verdict = 'DRIFT'
      detail = 'NOT_TRACKED（基线未被 HEAD 跟踪）'
    } else {
      const head = execFileSync('git', ['-C', ownRoot, 'show', `HEAD:${relPath}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      if (head.trim() === workRaw.trim()) {
        verdict = 'MATCH'
      } else {
        verdict = 'DRIFT'
        try {
          headObj = JSON.parse(head)
        } catch {
          /* HEAD 版本不可解析：仍按 DRIFT 报，差异明细留空 */
        }
      }
    }
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      // ⚠️ 基线文件**不存在**：这不是「git 不可用」，而是「冻结对象缺失」——
      // 报红 fail-closed。历史缺陷：ENOENT 曾落进 GIT_UNAVAILABLE ⇒ exit 0 假绿，
      // 于是「传个不存在的路径」就能让检查形同虚设（2026-09-18 实测踩中）。
      verdict = 'DRIFT'
      detail = `ENOENT（基线文件不存在：${freezeBaselineFile}）`
    } else {
      // 兜底：git show 因其它原因失败（权限/损坏/版本差异）。
      verdict = 'GIT_UNAVAILABLE'
      detail = `${e?.code ?? (e?.message || e)}`
    }
  }

  if (verdict === 'MATCH') {
    console.log(`[ratchet] 基线冻结校验通过：与 HEAD 提交版本一致（${relPath}）`)
    process.exit(0)
  }
  if (verdict === 'GIT_UNAVAILABLE') {
    console.warn(
      `::warning::[ratchet] 基线冻结校验降级：无法比对 git HEAD 版本（${detail}）——` +
        '不误红，但基线是否被本地改写无从判定，请以 CI 结果为准。'
    )
    process.exit(0)
  }
  console.error('::error::[ratchet] 基线文件与 HEAD 提交版本不一致——工作区基线已被本地改写：')
  if (detail) console.error(`  判定依据：${detail}`)
  if (headObj && workObj) {
    const diffs = METRICS.filter((m) => headObj[m] !== workObj[m]).map(
      (m) => `    ${m}: HEAD ${headObj[m]}% → 工作区 ${workObj[m]}%`
    )
    if (diffs.length) console.error(diffs.join('\n'))
  } else if (!workObj) {
    console.error('    工作区基线文件不可解析为 JSON（文件本身已损坏或已被删除）。')
  } else if (!headObj) {
    console.error('    HEAD 中没有该基线的提交版本（新增文件尚未提交，或已被删除）。')
  }
  console.error('  棘轮「只升不降」：基线被抬高后低覆盖率也能过，门禁就此钝化。')
  console.error('  处理：确认抬高确由新增测试带来后，**单独提交基线变更**并 review；')
  console.error(`  若为本地跑法差异（跳过部分套件等）导致，请还原：git checkout -- ${relPath}`)
  process.exit(1)
}

if (!summaryPath || !baselinePath) {
  console.error(
    '用法: node scripts/coverage-ratchet.cjs <coverage-summary.json> <baseline.json> [--update]\n' +
      '      node scripts/coverage-ratchet.cjs --freeze-check <baseline.json>'
  )
  process.exit(2)
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
const baselineFile = path.resolve(baselinePath)

// 读取基线：**只有 ENOENT（文件确实不存在）才算首跑**；不可读/JSON 语法错必须报错。
// 修复（EP-09/P1-06，2026-09-15）：原实现把「文件不存在」与「JSON 解析失败」放进同一个 catch，
// 二者都退化为 baseline=null → 重建并 exit 0 ⇒ 把基线改成坏 JSON 即可绕过覆盖率门禁。
let baseline = null
let baselineRaw = null
try {
  baselineRaw = fs.readFileSync(baselineFile, 'utf8')
} catch (e) {
  if (e && e.code === 'ENOENT') {
    baselineRaw = null // 真·首跑
  } else {
    console.error(
      `::error::基线文件不可读（${e?.code ?? e}）：${baselineFile}\n` +
        '  基线不可读必须报错，不得当作"首跑"重建（否则即可绕过覆盖率门禁）。'
    )
    process.exit(1)
  }
}
if (baselineRaw !== null) {
  try {
    baseline = JSON.parse(baselineRaw)
  } catch (e) {
    console.error(
      `::error::基线文件 JSON 解析失败（${baselinePath}）：${e.message}\n` +
        '  基线损坏必须报错，不得当作"首跑"重建（否则删/坏基线即可绕过覆盖率门禁）。'
    )
    process.exit(1)
  }
}

const current = {}
for (const m of METRICS) {
  const pct = summary.total?.[m]?.pct
  if (typeof pct !== 'number') {
    console.error(`::error::coverage-summary 缺少 total.${m}.pct（reporter 是否含 json-summary？）`)
    process.exit(2)
  }
  current[m] = pct
}

if (!baseline) {
  // 修复（EP-09/P1-06）：**CI 检查模式（未带 --update）禁止写盘**——否则删除基线文件即可让
  // 门禁静默重建并通过。首跑建档须由人显式 `--update` 执行并把基线文件提交入库。
  if (flag !== '--update') {
    console.error(
      `::error::基线文件不存在（${baselinePath}）且未带 --update：\n` +
        '  CI 检查模式禁止重建基线（否则删除基线即可绕过覆盖率门禁）。\n' +
        '  首次建档请本地执行：node scripts/coverage-ratchet.cjs <summary> <baseline> --update'
    )
    process.exit(1)
  }
  fs.writeFileSync(
    baselineFile,
    JSON.stringify({ ...current, updated: new Date().toISOString().slice(0, 10) }, null, 2) + '\n'
  )
  console.log(`[ratchet] 基线不存在，已按本次实测建档（--update）: ${baselinePath}`)
  console.log(JSON.stringify(current))
  process.exit(0)
}

// 基线 schema 校验：丢键/非数值会让 `baseline[m] - TOLERANCE` 得 NaN、
// 比较恒 false → 检查模式静默放行；--update 时 Math.max(undefined, x) 写出 null
// 静默损坏基线。故读入后显式校验，坏基线必须报错而不是装作通过。
const invalidMetrics = METRICS.filter(
  (m) => typeof baseline[m] !== 'number' || Number.isNaN(baseline[m])
)
if (invalidMetrics.length > 0) {
  console.error(
    `::error::基线文件损坏：指标 ${invalidMetrics.join('/')} 缺失或非数值（${baselinePath}）。` +
      `请修复该文件，或删除后以本次实测重建基线。`
  )
  process.exit(1)
}

const regressions = []
for (const m of METRICS) {
  const floor = baseline[m] - TOLERANCE
  if (current[m] < floor) {
    regressions.push(`  ${m}: 本次 ${current[m]}% < 基线 ${baseline[m]}% - ${TOLERANCE}pt 容差`)
  }
}

if (regressions.length > 0) {
  console.error('::error::覆盖率相对基线回退超容差（0.5pt）：')
  console.error(regressions.join('\n'))
  console.error('回退属实质信号，请补测试或确认删码范围；禁止调低基线规避。')
  process.exit(1)
}

if (flag === '--update') {
  // 写回时保留未知字段（如未来新增的 guards/note）——原实现用 {...next} 整体覆写，
  // 会把非 METRICS 字段静默丢掉（2026-09-18 审计 D-03 附）。
  const next = { ...baseline }
  let changed = false
  for (const m of METRICS) {
    next[m] = Math.max(baseline[m], current[m])
    if (next[m] !== baseline[m]) changed = true
  }
  if (changed) {
    fs.writeFileSync(
      baselineFile,
      JSON.stringify({ ...next, updated: new Date().toISOString().slice(0, 10) }, null, 2) + '\n'
    )
    console.log(`[ratchet] 基线已写回（只升不降）: ${baselinePath}`)
    // 显式提示：基线变更必须进版本库并接受 review。
    // 棘轮「只升不降」意味着**基线一旦被抬高就再也降不下来**（除非人工下调），
    // 因此本地 --update 后的基线文件本身是需要审阅的产物，不是随手带上的噪声。
    console.log(
      '[ratchet] ⚠️ 基线已变更——请把该文件一并提交，并确认抬高确由新增测试带来（非本地跑法差异）。'
    )
  } else {
    console.log('[ratchet] 本次无增长，基线不变')
  }
}

console.log(
  `[ratchet] 通过: ` + METRICS.map((m) => `${m} ${current[m]}% (基线 ${baseline[m]}%)`).join(' · ')
)
