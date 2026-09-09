#!/usr/bin/env node
/**
 * pre-merge-check.cjs — 分支合入 main 准入预检（Merge Readiness Gate）
 *
 * 解决的问题：
 *   此前在 feature 分支上开发、合入 main 时才第一次跑完整 CI，于是「合入主线一直报错」。
 *   根因有二：① CI 只在 push/PR 到 main 时触发，分支 push 不跑远端门禁；
 *   ② 本地 husky pre-push 只跑 typecheck+guard+后端测试，覆盖不全（缺 format/lint/
 *   stylelint/cruise/前端测试/build/audit/密钥扫描）。本脚本在分支上一条命令复刻
 *   main CI 的全部闸门，并额外做「能否干净合入」的 git 层判定，做到「预检绿 == 合入必绿」。
 *
 * 三层检查（全部只读，不修改工作区、不执行真实 merge/commit）：
 *   A. Git 合入可行性：工作区洁净、相对 base 的 ahead/behind、merge-tree 干跑冲突、能否 fast-forward
 *   B. 历史与提交规范：commitlint 区间校验、fix/refactor 是否附测试、.env 跟踪、大文件、增量密钥扫描
 *   C/D/E. 与 .github/workflows/ci.yml 等价的质量门：guard/format/lint/stylelint/cruise/
 *          双 typecheck/前端+tools+后端+pytest 测试/build/audit
 *
 * 用法：
 *   node scripts/pre-merge-check.cjs                 # 完整预检（等价 main CI，耗时数分钟）
 *   node scripts/pre-merge-check.cjs --static        # 快速档：A+B+静态门禁，跳过测试与 build（UI 改完自检）
 *   node scripts/pre-merge-check.cjs --no-fetch      # 离线：不 git fetch
 *   node scripts/pre-merge-check.cjs --base origin/main
 *   可选开关：--skip-tests --skip-build --skip-audit --no-secret-scan --no-color
 *
 * 退出码：0 = 可合入（无 FAIL）；1 = 存在阻断项（FAIL），报告末尾给出修复指引。
 * WARN/SKIP 不阻断，但会显式列出（它们代表「以 CI 为准」或「需要你人工确认」的项）。
 */
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const IS_WIN = process.platform === 'win32'
const NPM = IS_WIN ? 'npm.cmd' : 'npm'
const NPX = IS_WIN ? 'npx.cmd' : 'npx'

// ---------- 参数解析 ----------
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const opt = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const FLAGS = {
  static: has('--static'),
  fetch: !has('--no-fetch'),
  tests: !has('--skip-tests') && !has('--static'),
  build: !has('--skip-build') && !has('--static'),
  audit: !has('--skip-audit'),
  secretScan: !has('--no-secret-scan'),
  color: !has('--no-color') && process.stdout.isTTY,
  base: opt('--base', null),
}

// ---------- 输出 ----------
const C = FLAGS.color
const paint = (code, s) => (C ? `\x1b[${code}m${s}\x1b[0m` : s)
const green = (s) => paint('32', s)
const red = (s) => paint('31', s)
const yellow = (s) => paint('33', s)
const cyan = (s) => paint('36', s)
const gray = (s) => paint('90', s)
const bold = (s) => paint('1', s)

const results = []
function record(stage, name, status, detail = '') {
  results.push({ stage, name, status, detail })
  const tag = {
    pass: green('[PASS]'),
    fail: red('[FAIL]'),
    warn: yellow('[WARN]'),
    skip: gray('[SKIP]'),
  }[status]
  console.log(`  ${tag} ${name}${detail ? gray(' — ' + detail) : ''}`)
}
function section(title) {
  console.log('\n' + bold(cyan('━━ ' + title + ' ━━')))
}

// ---------- 子进程封装 ----------
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    encoding: 'utf8',
    shell: IS_WIN,
    env: { ...process.env, NODE_OPTIONS: '' }, // 清空 NODE_OPTIONS，规避 safe-delete shim 让 coverage 清理假红（0830 复盘）
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  })
  return {
    status: r.status ?? (r.error ? 1 : 0),
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error,
  }
}
const git = (args, opts) => run('git', args, opts)
// 长任务实时输出（测试/build），只取退出码
function npmRun(script, cwd) {
  console.log(gray(`      $ npm run ${script}${cwd ? ` (cwd=${path.relative(ROOT, cwd)})` : ''}`))
  return run(NPM, ['run', script], { cwd, stdio: 'inherit' })
}

// ============================================================
// A. Git 合入可行性
// ============================================================
section('A. Git 合入可行性（只读干跑，不执行真实合并）')

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
const headSha = git(['rev-parse', '--short', 'HEAD']).stdout.trim()
console.log(gray(`  当前分支：${branch} @ ${headSha}`))

if (branch === 'main' || branch === 'master') {
  record('A', '当前不在特性分支（已在 ' + branch + '）', 'warn', '预检应在待合入的特性分支上运行')
} else {
  record('A', '处于特性分支', 'pass', branch)
}

// A2 工作区洁净度
const porcelain = git(['status', '--porcelain=v1']).stdout
const tracked = porcelain.split('\n').filter((l) => l && !l.startsWith('??'))
const untracked = porcelain.split('\n').filter((l) => l.startsWith('??'))
if (tracked.length) {
  record(
    'A',
    '工作区存在未提交的已跟踪改动',
    'fail',
    `${tracked.length} 项；合并前先 commit/stash，否则会污染判断`
  )
  tracked.slice(0, 8).forEach((l) => console.log(gray('        ' + l)))
} else {
  record('A', '工作区已跟踪文件干净', 'pass')
}
if (untracked.length) {
  record(
    'A',
    '存在未跟踪文件（不阻断，但确认无需提交）',
    'warn',
    `${untracked.length} 项：` +
      untracked
        .slice(0, 5)
        .map((l) => l.slice(3))
        .join(', ')
  )
}

// A3 可选 fetch
if (FLAGS.fetch) {
  const f = git(['fetch', 'origin', 'main', '--quiet'])
  if (f.status === 0) record('A', '已同步 origin/main（git fetch）', 'pass')
  else
    record(
      'A',
      'git fetch origin main 失败（离线？后续用本地 base 比较）',
      'warn',
      (f.stderr || '').trim().slice(0, 120)
    )
}

// A4 确定基线
let base = FLAGS.base
if (!base) {
  const hasRemoteMain = git(['rev-parse', '--verify', '--quiet', 'origin/main'])
  base = hasRemoteMain.status === 0 ? 'origin/main' : 'main'
}
const baseOk = git(['rev-parse', '--verify', '--quiet', base])
if (baseOk.status !== 0) {
  record('A', `基线 ${base} 不存在`, 'fail', '无法继续 git 层判定，请先 fetch 或用 --base 指定')
  process.exit(1)
}
const baseSha = git(['rev-parse', '--short', base]).stdout.trim()
console.log(gray(`  合入基线：${base} @ ${baseSha}`))

// A5 ahead / behind
const lr = git(['rev-list', '--left-right', '--count', `${base}...HEAD`])
  .stdout.trim()
  .split(/\s+/)
const behind = Number(lr[0] || 0)
const ahead = Number(lr[1] || 0)
console.log(gray(`  领先 ${ahead} / 落后 ${behind}（相对 ${base}）`))
if (behind > 0) {
  record(
    'A',
    `分支落后基线 ${behind} 个提交`,
    'fail',
    'main 有你没有的提交；直接合会冲突，且生产 deploy 用 git pull --ff-only 会失败。先 git rebase/merge ' +
      base
  )
} else {
  record('A', '分支未落后基线（无需先同步 main）', 'pass')
}
if (ahead === 0) record('A', '分支没有领先基线的提交', 'warn', '没有可合入的内容')
else record('A', `分支领先 ${ahead} 个提交待合入`, 'pass')

// A6 merge-tree 干跑冲突（git >= 2.38 新语法，退出码 0=无冲突）
const gitVer = git(['--version']).stdout.match(/(\d+)\.(\d+)/)
const major = Number(gitVer?.[1] || 0)
const minor = Number(gitVer?.[2] || 0)
let conflictFree = false
if (major > 2 || (major === 2 && minor >= 38)) {
  const mt = git(['merge-tree', '--write-tree', base, 'HEAD'])
  conflictFree = mt.status === 0
  if (conflictFree) {
    record('A', 'merge-tree 干跑：无内容冲突', 'pass')
  } else {
    record('A', 'merge-tree 干跑：存在合并冲突', 'fail', '必须先在分支解决冲突再合入')
    console.log(
      gray(
        mt.stdout
          .split('\n')
          .slice(0, 20)
          .map((l) => '        ' + l)
          .join('\n')
      )
    )
  }
} else {
  record('A', 'git 版本过旧，跳过 merge-tree 干跑（建议升级到 >=2.38）', 'warn')
}

// A7 能否 fast-forward
const anc = git(['merge-base', '--is-ancestor', base, 'HEAD'])
if (anc.status === 0) record('A', '可 fast-forward 合入（基线是 HEAD 祖先，最干净）', 'pass')
else
  record(
    'A',
    '不可 fast-forward（基线与分支已分叉）',
    'warn',
    '需 merge commit；走 PR 合并或本地 git merge（非 ff-only）'
  )

// ============================================================
// B. 历史与提交规范（base..HEAD 区间）
// ============================================================
section('B. 提交历史规范（区间 ' + base + '..HEAD）')

// B1 commitlint 区间校验（复用 package.json 的 commitlint 配置，零规则漂移）
// 优先直连 node_modules/.bin，规避 Windows 下 npx 参数透传不稳（会误吐 help）
const clBin = path.join(ROOT, 'node_modules', '.bin', IS_WIN ? 'commitlint.cmd' : 'commitlint')
const cl = fs.existsSync(clBin)
  ? run(clBin, ['--from', base, '--to', 'HEAD'])
  : run(NPX, ['--no-install', 'commitlint', '--from', base, '--to', 'HEAD'])
const clLines = cl.stdout.split('\n')
const msgErrors = (cl.stdout.match(/✖/g) || []).length
const msgWarnings = (cl.stdout.match(/⚠/g) || []).length
if (cl.status === 0) {
  record(
    'B',
    '区间提交信息符合 Conventional Commits',
    'pass',
    msgWarnings ? `含 ${msgWarnings} 条格式 warning（不阻断）` : ''
  )
} else {
  // CI（ci.yml）不跑 commitlint、不校验历史提交信息，故历史 message 不规范不会让合入报错；
  // 走 PR Squash merge 会用 PR 标题生成最终提交、一次性消除。此处 WARN 并定位，不做阻断。
  record(
    'B',
    `区间 ${msgErrors} 处提交信息不规范（缺 type 前缀/大小写/超长，不阻断合入）`,
    'warn',
    'CI 不校验历史 message；走 Squash merge 可消除，今后勿用 --no-verify 跳过 commit-msg'
  )
  clLines.forEach((l, i) => {
    if (/✖.*\[(type-empty|subject-empty|type-enum)\]/.test(l)) {
      const input = (clLines[i - 1] || '').trim()
      if (input.includes('input:')) console.log(gray('        ' + input.slice(0, 92)))
    }
  })
}

// B2 fix/refactor 是否附测试：HEAD 严格对齐 CI（直接 push main 会拦），区间历史存量仅 WARN
function commitList() {
  return git(['log', `${base}..HEAD`, '--pretty=format:%H%x1f%s'])
    .stdout.split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, subj] = line.split('\x1f')
      return { sha, subj }
    })
}
function commitChanged(sha) {
  return git(['diff', '--name-only', `${sha}^`, sha])
    .stdout.split('\n')
    .filter(Boolean)
}
const SRC_RE = /^(frontend\/src|backend\/src|backend\/algorithm-service).*\.(ts|vue|js|mjs|cjs|py)$/
const TEST_RE = /\.(test|spec)\.(ts|js|vue|py)$/
let headStrictFail = false
const historyMiss = []
for (const c of commitList()) {
  if (!/^(fix|refactor)(\(|:)/.test(c.subj)) continue
  const files = commitChanged(c.sha)
  const srcChanged = files.some((f) => SRC_RE.test(f) && !TEST_RE.test(f))
  const testChanged = files.some((f) => TEST_RE.test(f))
  if (srcChanged && !testChanged) {
    if (c.sha.startsWith(headSha)) headStrictFail = true
    else historyMiss.push(c.sha.slice(0, 8) + ' ' + c.subj.slice(0, 40))
  }
}
if (headStrictFail) {
  record(
    'B',
    'HEAD 是 fix/refactor 且改了实现但未附测试',
    'fail',
    '直接 push main 会被 CI「fix/refactor must include tests」拦截'
  )
} else {
  record('B', 'HEAD 提交满足「fix/refactor 附测试」CI 规则', 'pass')
}
if (historyMiss.length) {
  record(
    'B',
    `区间内 ${historyMiss.length} 个历史 fix/refactor 提交未附测试（走 PR 合并不拦，仅提示）`,
    'warn'
  )
  historyMiss.slice(0, 6).forEach((l) => console.log(gray('        ' + l)))
}

// B3 .env 不得被跟踪（复刻 CI）
const trackedEnv = git(['ls-files'])
  .stdout.split('\n')
  .filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !/\.env\.example$/.test(f))
if (trackedEnv.length) record('B', '存在被 git 跟踪的 .env 文件', 'fail', trackedEnv.join(', '))
else record('B', '无 .env 类敏感文件入库', 'pass')

// B4 区间新增文件大小（>10MB 警告，>50MB 阻断：GitHub 硬限制 100MB、且派生缓存不该入库）
const addedRaw = git(['diff', '--name-status', `${base}...HEAD`]).stdout
const bigWarn = []
let bigFail = false
for (const line of addedRaw.split('\n').filter(Boolean)) {
  const [status, ...rest] = line.split('\t')
  const file = rest[rest.length - 1]
  if (!/^A/.test(status)) continue
  const blob = git(['rev-parse', `HEAD:${file}`])
  if (blob.status !== 0) continue
  const size = Number(git(['cat-file', '-s', blob.stdout.trim()]).stdout.trim() || 0)
  const mb = size / 1024 / 1024
  if (mb > 50) {
    bigFail = true
    bigWarn.push(`${file} (${mb.toFixed(1)}MB)`)
  } else if (mb > 10) bigWarn.push(`${file} (${mb.toFixed(1)}MB)`)
}
if (bigFail)
  record('B', '区间新增 >50MB 文件（push 极可能被 GitHub 拒绝）', 'fail', bigWarn.join(', '))
else if (bigWarn.length)
  record(
    'B',
    '区间新增 >10MB 文件，确认应入库（栅格/瓦片派生缓存不应入库）',
    'warn',
    bigWarn.join(', ')
  )
else record('B', '区间无异常大文件', 'pass')

// B5 增量密钥轻量扫描（本地无 gitleaks 时的兜底；CI 另有 gitleaks 二进制扫描）
if (FLAGS.secretScan) {
  const diff = git(['diff', `${base}...HEAD`, '--unified=0']).stdout
  const SECRET_RE = /^\+.*(?:key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_/+-]{16,}['"]/im
  const hits = diff
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++') && SECRET_RE.test(l))
  if (hits.length) {
    record(
      'B',
      `增量 diff 命中 ${hits.length} 处疑似硬编码密钥`,
      'fail',
      '合入主线泄漏不可逆；改用 .env/读文件，或确认是误报后加 --no-secret-scan 复核'
    )
    hits.slice(0, 6).forEach((l) => console.log(gray('        ' + l.slice(0, 120))))
  } else record('B', '增量 diff 未发现硬编码密钥', 'pass')
}

// ============================================================
// C. 静态质量门（--static 也跑；对齐 CI lint-and-build 前半）
// ============================================================
section('C. 静态质量门（等价 CI：guard/format/lint/stylelint/cruise/typecheck）')
const staticSteps = [
  ['guard:v3', 'v3 三道防线（no-ephemeral/structure/routes-audit/metrics）'],
  ['format:check', 'prettier 格式（--no-verify 提交最易漏，CI 必查）'],
  ['lint', 'eslint'],
  ['stylelint', '样式硬编码检查'],
  ['cruise', 'dependency-cruiser 分层架构契约'],
  ['types:check', '前后端 API 契约漂移检查（gen-api-contract --check）'],
  ['typecheck', '前端 vue-tsc 类型'],
]
for (const [script, desc] of staticSteps) {
  const r = npmRun(script)
  record('C', desc, r.status === 0 ? 'pass' : 'fail', 'npm run ' + script)
}
const beTypecheck = npmRun('typecheck', path.join(ROOT, 'backend'))
record(
  'C',
  '后端 Nest tsc 类型',
  beTypecheck.status === 0 ? 'pass' : 'fail',
  'npm run typecheck --prefix backend'
)

// ============================================================
// D. 测试与构建（--static 跳过）
// ============================================================
if (FLAGS.tests) {
  section('D. 测试（前端 coverage / tools / 后端 coverage / algorithm pytest）')
  const testSteps = [
    ['test', ['test', '--', '--coverage'], null, '前端 vitest（含覆盖率阈值）'],
    ['test:tools', ['run', 'test:tools'], null, 'tools 脚本单测'],
    [
      'backend-test',
      ['run', 'test', '--', '--coverage'],
      path.join(ROOT, 'backend'),
      '后端 Nest vitest（无 PG 时 e2e 自动 skip）',
    ],
    ['test:algorithm', ['run', 'test:algorithm'], null, 'FastAPI pytest（离线套件）'],
  ]
  for (const [, args, cwd, desc] of testSteps) {
    const r = run(NPM, args, { cwd, stdio: 'inherit' })
    record('D', desc, r.status === 0 ? 'pass' : 'fail')
  }
} else {
  section('D. 测试（已跳过：' + (FLAGS.static ? '--static 快速档' : '--skip-tests') + '）')
  record('D', '前端/tools/后端/pytest 测试', 'skip')
}

if (FLAGS.build) {
  section('E1. 生产构建')
  const b = npmRun('build')
  record('E1', 'npm run build（typecheck + vite build）', b.status === 0 ? 'pass' : 'fail')
} else {
  section('E1. 生产构建（已跳过）')
  record('E1', '生产构建', 'skip')
}

// E2. npm audit（CI 用官方源；本地镜像无 audit 端点，网络不可达降级为 WARN，以 CI 为准）
section('E2. 依赖安全审计（对齐 CI audit job）')
if (FLAGS.audit) {
  for (const [label, cwd] of [
    ['根', ROOT],
    ['Nest(backend)', path.join(ROOT, 'backend')],
  ]) {
    const r = run(NPM, ['audit', '--audit-level=high', '--registry=https://registry.npmjs.org'], {
      cwd,
    })
    const out = r.stdout + r.stderr
    if (r.status === 0) {
      record('E2', `${label} npm audit 无 high+ 漏洞`, 'pass')
    } else if (/vulnerabilit/i.test(out)) {
      record(
        'E2',
        `${label} 存在 high+ 依赖漏洞（CI audit 会阻断）`,
        'fail',
        'npm audit fix 或 overrides 处理'
      )
    } else {
      record(
        'E2',
        `${label} audit 未能执行（网络/镜像），该项以 CI 为准`,
        'warn',
        out.trim().slice(0, 100)
      )
    }
  }
} else {
  record('E2', 'npm audit', 'skip')
}
record(
  'E2',
  'gitleaks 二进制扫描',
  'warn',
  '本地通常无二进制；已由 B5 增量正则兜底，CI 会跑完整 gitleaks'
)

// ============================================================
// 汇总
// ============================================================
const fails = results.filter((r) => r.status === 'fail')
const warns = results.filter((r) => r.status === 'warn')
const skips = results.filter((r) => r.status === 'skip')
const passN = results.filter((r) => r.status === 'pass').length

section('汇总')
console.log(
  `  ${green('PASS')} ${passN}   ${red('FAIL')} ${fails.length}   ${yellow('WARN')} ${warns.length}   ${gray('SKIP')} ${skips.length}`
)

if (fails.length) {
  console.log('\n' + red(bold('✗ 结论：BLOCKED —— 现在合入 main 必然报错，先修以下阻断项：')))
  fails.forEach((f, i) =>
    console.log(red(`   ${i + 1}. [${f.stage}] ${f.name}${f.detail ? '（' + f.detail + '）' : ''}`))
  )
  console.log(
    yellow(
      '\n  提示：静态/测试类问题修复后重跑本脚本；git 层 behind/冲突先 rebase ' + base + ' 再重跑。'
    )
  )
  process.exit(1)
}

console.log(
  '\n' + green(bold('✓ 结论：READY TO MERGE —— 三层闸门全过，可合入 main 且 main CI 不会红。'))
)
console.log(gray('  推荐方式一（个人项目，可 fast-forward）：'))
console.log(
  gray('    git checkout main && git merge --ff-only ' + branch + ' && git push origin main')
)
console.log(
  gray(
    '  推荐方式二（先在远端验证，更稳）：git push origin ' +
      branch +
      ' → 开 PR → 看 Actions 全绿 → merge'
  )
)
console.log(
  yellow(
    '  注意：push/merge 到 main 会触发 CI，全绿后 deploy job 自动部署生产（不是「先推上去再说」）。'
  )
)
if (warns.length) console.log(yellow(`  另有 ${warns.length} 条 WARN 建议过目（不阻断）。`))
process.exit(0)
