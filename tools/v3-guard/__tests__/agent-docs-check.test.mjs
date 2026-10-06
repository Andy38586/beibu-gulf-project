import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  checkClaimReachability,
  checkCommitForm,
  checkLiveDocs,
  checkRefs,
  classify,
  extractCommitExamples,
  extractClaimedScripts,
  extractTokens,
  isGitIgnored,
  LIVE_DOCS,
  prefixedRefs,
  stripCommitType,
  triggerSurfaceFiles,
} from '../agent-docs-check.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const NONE = () => false
const some = (set) => (p) => set.has(p)

describe('agent-docs-check（作业协议自述守卫）', () => {
  it('@guard-red-sample 阳性对照：带目录前缀的断链必须判违规', () => {
    const bad = checkRefs([{ token: 'docs/根基文档/01-项目全景.md', line: 4 }], NONE)
    expect(bad).toHaveLength(1)
    expect(bad[0].why).toContain('不存在')
  })

  it('阳性对照：裸 .md 零命中=断链、多命中=歧义、通用名豁免', () => {
    expect(checkRefs([{ token: '01-项目全景.md', line: 18 }], NONE)).toHaveLength(1)
    const ambiguous = some(new Set(['docs/A.md', 'docs/根基文档/A.md']))
    expect(checkRefs([{ token: 'A.md', line: 1 }], ambiguous)).toHaveLength(1)
    const readmeEverywhere = some(new Set(['README.md', 'docs/README.md']))
    expect(checkRefs([{ token: 'README.md', line: 1 }], readmeEverywhere)).toHaveLength(0)
  })

  it('命令、glob、占位符、npm 包名不当作路径；带斜杠的目录引用要校验存在性', () => {
    for (const t of [
      'npm run typecheck',
      'frontend/src/**/*.{ts,vue}',
      'type(scope): 中文说明',
      '@commitlint/config-conventional',
    ])
      expect(classify(t), t).toBeNull()
    expect(classify('docs/audits/')).toEqual({ kind: 'prefixed', value: 'docs/audits/' })
    expect(checkRefs([{ token: 'docs/nope/', line: 1 }], NONE)).toHaveLength(1)
  })

  it('@guard-red-sample 尾斜杠目录引用必须被抽出并校验（R6-07：旧版在 prefixedRefs 一律 skip）', () => {
    expect(
      prefixedRefs('产出见 `docs/audits/923/` 与 `frontend/src/`').map((r) => r.token)
    ).toEqual(['docs/audits/923/', 'frontend/src/'])
    expect(prefixedRefs('glob 与占位符不算：`docs/audits/*/`、`docs/audits/<日期>/`')).toEqual([])
  })

  it('行号后缀必须先剥，否则真路径会被误判断链', () => {
    expect(classify('tools/db/db-schema.sql:77')).toEqual({
      kind: 'prefixed',
      value: 'tools/db/db-schema.sql',
    })
  })

  it('commit 示例只认「例：」，格式占位符不入样', () => {
    const text = '形式 `type(scope): 中文说明`\n  - 例：`fix(task): 修 forecast-map 域恒 400`\n'
    expect(extractCommitExamples(text)).toEqual([
      { message: 'fix(task): 修 forecast-map 域恒 400', line: 2 },
    ])
  })

  it('协议里没有「例：」示例时报红，而不是静默通过', () => {
    expect(checkCommitForm('# 没有示例的协议\n').violations).toHaveLength(1)
  })

  it('@guard-red-sample commitlint 不可用 ⇒ 记 SKIPPED，不判红（§5.4 工具不可用不判红也不判绿）', () => {
    const unavailable = () => ({ rc: null, why: 'commitlint CLI 缺失，无法校验断言 3' })
    const r = checkCommitForm('例：`fix: 修 xxx`\n', unavailable)
    expect(r.violations).toEqual([]) // 关键：环境问题不冒充协议失真
    expect(r.skipped).toHaveLength(3) // 正向示例 + 反向样本 + 带 scope 三条
    expect(r.skipped[0].why).toContain('commitlint')
  })

  it('@guard-red-sample 反向样本被放行 ⇒ 必报（hook 规则没生效 = 恒真摆设）', () => {
    const alwaysPass = () => ({ rc: 0 })
    const r = checkCommitForm('例：`fix: 修 xxx`\n', alwaysPass)
    expect(r.violations.map((v) => v.why).join(' ')).toContain('恒真摆设')
  })

  it('@guard-red-sample 带 scope 样本被放行 ⇒ 必报（口径禁 type(scope) 却无机器判据）', () => {
    // 模拟：正向过、剥 type 的反向被拒、唯独带 scope 的被放行
    const lint = (msg) => ({ rc: msg.includes(': ') ? 0 : 1 })
    const r = checkCommitForm('例：`fix: 修 forecast-map 域恒 400`\n', lint)
    expect(r.violations.map((v) => v.why).join(' ')).toContain('无机器判据')
  })

  it('@guard-red-sample 版本控制之外的目标（gitignored）⇒ 不做存在性断言；默认仍从严', () => {
    const ignored = (rel) => rel === '.local/'
    expect(checkRefs([{ token: '.local/', line: 1 }], NONE, ignored)).toEqual([])
    // 不传 isIgnored 时保持默认从严（纯函数不被环境牵着走）
    expect(checkRefs([{ token: '.local/', line: 1 }], NONE)).toHaveLength(1)
  })

  it('@guard-red-sample 活文档里的 gitignored 引用 ⇒ 不做存在性断言；默认仍从严', () => {
    // 干净检出/CI 里该件不存在，断言存在性会误红；豁免后必须放行
    expect(checkLiveDocs(['AGENTS.md'], NONE, () => true)).toEqual([])
    // 阳性对照：同一输入不传 isIgnored 时必须仍报（豁免只作用于版本控制之外的目标）
    expect(checkLiveDocs(['AGENTS.md'], NONE).length).toBeGreaterThan(0)
  })

  it('反向样本剥出的就是裸主题（它必须被 commitlint 拒）', () => {
    expect(stripCommitType('fix(task): 穷尽派生 TASK_DOMAINS')).toBe('穷尽派生 TASK_DOMAINS')
  })

  it('回归锚：现存两份协议文件必须自洽（含「版本控制之外不判断链」口径）', () => {
    for (const rel of ['AGENTS.md', 'CLAUDE.md']) {
      const entries = extractTokens(fs.readFileSync(path.join(ROOT, rel), 'utf8')).map((e) => ({
        ...e,
        file: rel,
      }))
      expect(checkRefs(entries, undefined, isGitIgnored), rel).toEqual([])
    }
  })

  it('阳性对照：只取仓库根锚定路径；目录引用同样抽取（存在与否由 checkLiveDocs 判），分层名/分支名不算', () => {
    const text = [
      '死路径 `backend/src/nope.ts` 必须被抓',
      '历史留痕 `backend/dead/legacy.js` 已退役，按行豁免',
      '目录 `frontend/src/` 与分层名 `types/` 不算',
      '分支名 `experiment/v3-backend-migration` 不算',
      '相对索引 `根基文档/项目全景.md` 不算（它相对 docs/ 解析）',
    ].join('\n')
    expect(prefixedRefs(text).map((r) => r.token)).toEqual([
      'backend/src/nope.ts',
      'backend/dead/legacy.js',
      'frontend/src/',
    ])
    expect(prefixedRefs(text)[1].exempt).toBe(true)
  })

  it('回归锚：全部活文档当前无断链（按生产口径含 gitignored 豁免）', () => {
    // 必须与 run() 的调用口径一致：干净检出/CI 里 gitignored 目标不存在，
    // 用严格默认调会在 CI 上误红（这是 test:tools 在 CI 红的第二处消费点）。
    expect(checkLiveDocs(LIVE_DOCS, undefined, isGitIgnored)).toEqual([])
  })

  it('🔴 口径单源（W13）：三份文档都禁 `type(scope)`，且 commitlint 侧有对应机器判据', () => {
    // ① 配置侧：口径写"禁"，就必须有能拦住的规则——删掉 scope-empty ⇒ 本用例红
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    expect(
      pkg.commitlint?.rules?.['scope-empty']?.[0],
      'commitlint 缺少 scope-empty 规则：口径"禁 type(scope)"没有机器判据'
    ).toBe(2)

    // ② 文档侧：三处口径必须一致地写成"禁 <type>(<scope>)"，且没人把 `type(scope): 中文说明`
    //    当推荐格式（2026-09-24 之前 `开发指南与决策.md` 红线 2 正是这么写的，与 §1.6 冲突）
    for (const rel of ['AGENTS.md', 'CLAUDE.md', 'docs/根基文档/开发指南与决策.md']) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
      expect(/禁[^\n]{0,10}<?type>?\(<?scope/.test(text), `${rel} 未写明禁 type(scope)`).toBe(true)
      expect(text, `${rel} 仍把 type(scope): 当推荐写法`).not.toMatch(/`type\(scope\): 中文说明`/)
    }
  })

  it('@guard-red-sample 声称的 npm script 无触发面且未豁免 ⇒ 必报', () => {
    const v = checkClaimReachability({
      agentsText: '准备合并：`npm run ghost`',
      triggerTexts: { '.husky/pre-push': 'npm run guard:v3' },
      packageScripts: { ghost: 'node ghost.mjs' },
      k4Text: '',
    })
    expect(v).toHaveLength(1)
    expect(v[0].why).toContain('触发面')
  })

  it('@guard-red-sample 幽灵命令：声称的 script 不在 package.json ⇒ 必报', () => {
    const v = checkClaimReachability({
      agentsText: '下一步 `npm run does-not-exist`',
      triggerTexts: { '.husky/pre-push': 'npm run does-not-exist' },
      packageScripts: { 'guard:v3': 'x' },
      k4Text: '',
    })
    expect(v).toHaveLength(1)
    expect(v[0].why).toContain('幽灵命令')
  })

  it('阳性对照：触发面命中或列入 K4 豁免 ⇒ 不报', () => {
    const base = {
      triggerTexts: { '.husky/pre-push': 'npm run guard:v3' },
      packageScripts: { 'guard:v3': 'x', 'review:score': 'y' },
      k4Text: '### 手动工具豁免清单\n| `npm run review:score` |\n## §2 任务流程\n',
    }
    expect(checkClaimReachability({ agentsText: '`npm run guard:v3`', ...base })).toEqual([])
    expect(checkClaimReachability({ agentsText: '`npm run review:score`', ...base })).toEqual([])
  })

  it('@guard-red-sample 幽灵豁免：K4 清单列了 package.json 不存在的 script ⇒ 必报', () => {
    const v = checkClaimReachability({
      agentsText: '',
      triggerTexts: {},
      packageScripts: {},
      k4Text: '### 手动工具豁免清单\n| `npm run ghost:tool` |\n## §2 任务流程\n',
    })
    expect(v).toHaveLength(1)
    expect(v[0].why).toContain('幽灵豁免')
  })

  it('声称面提取含数字：`guard:v3` 不得被截成 `guard:v`（指标 9.1 的已知坑）', () => {
    expect(extractClaimedScripts('跑 `npm run guard:v3` 与 `npm run e2e2`')).toEqual([
      { script: 'guard:v3', line: 1 },
      { script: 'e2e2', line: 1 },
    ])
  })

  it('回归锚：现仓 AGENTS 声称面可达（按生产口径读钩子/workflow/package/K4）', () => {
    const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
    const triggerTexts = {}
    for (const rel of triggerSurfaceFiles(ROOT)) triggerTexts[rel] = read(rel)
    const pkg = JSON.parse(read('package.json'))
    expect(
      checkClaimReachability({
        agentsText: read('AGENTS.md'),
        triggerTexts,
        packageScripts: pkg.scripts ?? {},
        k4Text: read('docs/契约/K4-开发与门禁契约.md'),
      })
    ).toEqual([])
  })
})
