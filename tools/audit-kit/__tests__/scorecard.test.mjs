/**
 * scorecard 的自测 —— 重点是「它不许被喂成假绿」。
 * 每条负数结论都要有同形态的阳性对照（AGENTS §5.4）。
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  auditAnchors,
  auditCoverage,
  auditHooks,
  auditTags,
  failedThresholds,
  renderScore,
  resolveAnchor,
  scoreBatch,
  windowFiles,
} from '../scorecard.mjs'
import { ROOT } from '../paths.mjs'

const HERE = 'tools/audit-kit/scorecard.mjs'

describe('scorecard — 窗口发现（1004-17）', () => {
  it('🔴 00-* 窗口件纳入；只排除 00-记分卡 与 README（改回 ^00- 排除即红）', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'score-window-'))
    writeFileSync(path.join(dir, '00-审查体系逐行复核-执行记录.md'), '# 窗\n')
    writeFileSync(path.join(dir, '00-记分卡.md'), '# 产物\n')
    writeFileSync(path.join(dir, 'README.md'), '# 说明\n')

    const files = windowFiles(dir)
    const ids = files.map((f) => f.id)
    expect(ids).toContain('00-审查体系逐行复核-执行记录.md')
    expect(ids).not.toContain('00-记分卡.md')
    expect(ids).not.toContain('README.md')
  })

  it('🔴 混合命名（1004-QC-06）：W*.md 与非 W 窗件同时纳入；问题副本是衍生物不占窗（1005-QC-02）', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'score-mixed-'))
    writeFileSync(path.join(dir, 'W1.md'), '# W1\n')
    writeFileSync(path.join(dir, '专项1-数据链审查-执行记录.md'), '# 执行记录\n')
    writeFileSync(path.join(dir, '专项1-数据链审查-问题副本.md'), '# 问题副本\n')
    writeFileSync(path.join(dir, '00-派单账.md'), '# 派单账\n')
    const ids = windowFiles(dir).map((f) => f.id)
    expect(ids).toContain('W1')
    expect(ids).toContain('专项1-数据链审查-执行记录.md')
    // 问题副本 = 窗口 §2 的衍生物：当窗会让「无负责集的窗」凭空多一条
    expect(ids).not.toContain('专项1-数据链审查-问题副本.md')
    // 00-派单账 = 派单器产物（与 00-记分卡 同类），不是窗口
    expect(ids).not.toContain('00-派单账.md')
  })
})

describe('scorecard — 锚点量尺（可复核 / 真实 是两个数，不许合成一个）', () => {
  it('真实文件 + 合法行 ⇒ 真；同形态换成越界行 ⇒ 行越界', () => {
    const good = auditAnchors(`${HERE}:12`, ROOT)
    expect(good.真).toBe(1)
    expect(good.可核).toBe(1)
    const bad = auditAnchors(`${HERE}:999999`, ROOT)
    expect(bad.行越界).toBe(1)
    expect(bad.真实率).toBe(0)
    const none = auditAnchors('tools/audit-kit/definitely-not-here.mjs:3', ROOT)
    expect(none.找不到).toBe(1)
    expect(none.真实率).toBe(null)
  })

  it('裸文件名：唯一命中可解析，同名多份判歧义（歧义不得被算成真）', () => {
    // 索引取自 git ls-files ⇒ 只能用已跟踪文件做样本（未提交的新工具本就应判「找不到」）
    const uniq = resolveAnchor('metrics-tally.mjs', [ROOT])
    expect(uniq.态).toBe(null)
    expect(uniq.abs.replace(/\\/g, '/')).toContain('tools/v3-guard/metrics-tally.mjs')
    expect(resolveAnchor('README.md', [ROOT]).态).toBe('同名歧义')
  })

  it('中文路径锚点被认出 + 行界/内容两把尺分开（该文件 224 行实为空白 ⇒ 可核但非真）', () => {
    const r = auditAnchors('`docs/根基文档/审查体系专项/专项1-数据链审查.md:224`', ROOT)
    expect(r.总数).toBe(1)
    expect(r.可核).toBe(1)
    expect(r.空白行).toBe(1)
    expect(r.真).toBe(0)
    // 阳性对照：同文件 225 行有内容 ⇒ 真（旧正则的 \\w 缺陷也一并钉住）
    expect(auditAnchors('`docs/根基文档/审查体系专项/专项1-数据链审查.md:225`', ROOT).真).toBe(1)
  })

  it('全量裸文件名的批次只能得「未取证」，不得得达标（防削分母造假绿）', () => {
    const a = auditAnchors('README.md:5 README.md:9', ROOT)
    expect(a.可核).toBe(0)
    expect(a.真实率).toBe(null)
    expect(a.可复核率).toBe(0)
  })
})

describe('scorecard — §0 契约与覆盖率、归属标签', () => {
  const md = [
    '## §0',
    '```bash',
    'git rev-parse --short HEAD',
    '# 期望: abc1234',
    'npm test',
    'node tools/audit-kit/dispatch.mjs --dry',
    '# 期望: [dispatch] 1 窗',
    '```',
  ].join('\n')

  it('带期望的命令计数，裸命令单独列出（不被静默放行）', () => {
    const h = auditHooks(md)
    expect(h.块数).toBe(1)
    expect(h.命令).toBe(3)
    expect(h.带期望).toBe(2)
    expect(h.裸命令).toEqual(['npm test'])
  })

  it('一个 bash 块都没有 ⇒ 判未交付形态（块数 0，可复跑判据 0）', () => {
    const h = auditHooks('## §0\n\n我跑过了，全绿。')
    expect(h.块数).toBe(0)
    expect(h.带期望).toBe(0)
  })

  it('覆盖率分母来自负责集：点名+有结论词才算判定点', () => {
    const 负责 = ['专1-1.1', '专1-1.2', '专1-1.3']
    const body =
      '专1-1.1 硬编码色值 P1\n\n| 指标 1.2 | 通过 |\n\n专1-1.3 提到了但没结论\n\n顺带引用了 专2-3.4 P2'
    const c = auditCoverage(body, 负责)
    expect(c.判定点).toEqual(['专1-1.1', '专1-1.2'])
    expect(c.未判).toEqual(['专1-1.3'])
    expect(c.越界).toEqual(['专2-3.4'])
    expect(c.覆盖率).toBeCloseTo(2 / 3)
  })

  it('空负责集 ⇒ 覆盖率 null（未取证），不得当 100%', () => {
    expect(auditCoverage('随便什么 P1', []).覆盖率).toBe(null)
  })

  it('归属四态：反引号形态计数；条目没打标 ⇒ 未打标计数，膨胀率不伪装成 0', () => {
    const t = auditTags('| P1 x `引入` y\n| P1 z `收口不足`\n| P2 w 无标签')
    expect(t.标签.引入).toBe(1)
    expect(t.标签.收口不足).toBe(1)
    expect(t.修复条目数).toBe(3)
    expect(t.未打标).toBe(1)
    expect(t.膨胀率).toBeCloseTo(0.67)
  })

  it('🔴 内容级下限（1004-QC-03）：锚点指到空白行 ⇒ 不判真；同文件有内容行 ⇒ 真（阳性对照）', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'score-blank-'))
    mkdirSync(path.join(dir, 'sub'), { recursive: true })
    writeFileSync(path.join(dir, 'sub', 'blank.md'), '# t\n\nreal\n')
    const bad = auditAnchors('sub/blank.md:2', dir)
    expect(bad.空白行).toBe(1)
    expect(bad.真).toBe(0)
    expect(bad.真实率).toBe(0)
    expect(auditAnchors('sub/blank.md:3', dir).真).toBe(1)
  })

  it('🔴 判据面只算 §0（1004-QC-03）：§3 里带 `# 期望:` 的块不得充数', () => {
    const doc = [
      '## §0 入口',
      '```bash',
      'npm run a',
      '# 期望: ok',
      '```',
      '',
      '## §3 钩子',
      '```bash',
      'git status',
      '# 期望: clean',
      '```',
    ].join('\n')
    const h = auditHooks(doc)
    expect(h.带期望).toBe(1)
    expect(h.块数).toBe(1)
  })

  it('🔴 条目三形态都识别（1004-QC-03/07）：P 前缀 / 全角括号 / 分隔符+加粗档位', () => {
    const t = auditTags('### F1（P0）foo\n### G1：bar｜**P1**｜baz\n| P2 x\n### 无档位')
    expect(t.修复条目数).toBe(3)
  })

  it('🔴 归属：**引入**（非反引号）也计入（1004-QC-07），同一行只记一次', () => {
    const t = auditTags('### G9：x｜**P1**｜y\n归属：**引入**\n### G10：z｜**P2**｜w\n归属：`流程`')
    expect(t.标签.引入).toBe(1)
    expect(t.标签.流程).toBe(1)
    expect(t.带归属条目数).toBe(2)
    expect(t.未打标).toBe(0)
  })

  it('RC 打标：只数产物里真写的（RC1–RC4），没写就是 0 条', () => {
    expect(auditTags('这条属 `RC2` 与 RC1 各一次').RC).toEqual({ RC1: 1, RC2: 1, RC3: 0, RC4: 0 })
  })
})

describe('scorecard — 端到端（真批次目录，不落仓库根）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bbg-score-'))
  writeFileSync(
    path.join(dir, 'claims.json'),
    JSON.stringify({ 窗: [{ id: 'W1', 指标: ['专1-1.1', '专1-1.2'] }] })
  )
  writeFileSync(
    path.join(dir, 'W1.md'),
    `## §0
\`\`\`bash
git rev-parse --short HEAD
# 期望: $(echo placeholder)
\`\`\`

专1-1.1 见 ${HERE}:12 —— P1
`
  )
  const b = scoreBatch(dir)

  it('claims 驱动覆盖率：2 条负责、1 条判定点', () => {
    expect(b.窗数).toBe(1)
    expect(b.窗账[0].负责数).toBe(2)
    expect(b.总.覆盖).toBeCloseTo(0.5)
  })

  it('锚点少 ⇒ 绝对锚点门槛未达标（不是「通过」）', () => {
    expect(b.门槛.绝对锚点).toBe('未达标')
    expect(b.总.锚点总数).toBe(1)
    expect(b.总.锚点真实率).toBe(1)
  })

  it('记分卡正文点名未达标项，且「未取证」不会被写成达标', () => {
    const md = renderScore(b)
    expect(md).toContain('**未达标**')
    expect(md).toContain('可复核率')
    const empty = scoreBatch(mkdtempSync(path.join(tmpdir(), 'bbg-score2-')))
    expect(renderScore(empty)).toContain('未取证')
    // 无未达标项但有未取证 ⇒ 不许打「全部门槛达标」（QC-02 同族：缺输入不是达标）
    expect(renderScore(empty)).not.toContain('全部门槛达标')
    expect(renderScore(empty)).toContain('未取证**')
  })

  it('🔴 批末门禁 --strict：无 claims.json ⇒ 覆盖率未取证也判失败（默认口径不红）', () => {
    const noClaims = scoreBatch(mkdtempSync(path.join(tmpdir(), 'bbg-score3-')))
    expect(noClaims.门槛.覆盖率).toContain('未取证')
    // 默认：未取证不拦（缺输入 ≠ 违规），只有未达标红
    expect(failedThresholds(noClaims, false).map(([k]) => k)).not.toContain('覆盖率')
    // --strict：未取证同样红 —— claims.json 交件必填
    expect(failedThresholds(noClaims, true).map(([k]) => k)).toContain('覆盖率')
    // 阳性对照：有 claims（覆盖率「已算」）时 strict 不因覆盖率红
    expect(failedThresholds(b, true).map(([k]) => k)).not.toContain('覆盖率')
  })
})
