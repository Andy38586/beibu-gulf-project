/**
 * scorecard 的自测 —— 重点是「它不许被喂成假绿」。
 * 每条负数结论都要有同形态的阳性对照（AGENTS §5.4）。
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  auditAnchors,
  auditCoverage,
  auditHooks,
  auditTags,
  renderScore,
  resolveAnchor,
  scoreBatch,
} from '../scorecard.mjs'
import { ROOT } from '../paths.mjs'

const HERE = 'tools/audit-kit/scorecard.mjs'

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

  it('中文路径的锚点必须被认出来（旧正则用 \\w 会把 `专项1-x.md:47` 截成 `.md:47`）', () => {
    const r = auditAnchors('`docs/根基文档/审查体系专项/专项1-数据链审查.md:224`', ROOT)
    expect(r.总数).toBe(1)
    expect(r.真).toBe(1)
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

  it('归属四态只数反引号标签；条目没打标 ⇒ 未打标计数，膨胀率不伪装成 0', () => {
    const t = auditTags('| P1 x `引入` y\n| P1 z `收口不足`\n| P2 w 无标签')
    expect(t.标签.引入).toBe(1)
    expect(t.标签.收口不足).toBe(1)
    expect(t.修复条目数).toBe(3)
    expect(t.未打标).toBe(1)
    expect(t.膨胀率).toBeCloseTo(0.67)
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
  })
})
