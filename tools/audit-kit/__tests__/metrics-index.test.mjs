/**
 * metrics-index 的自测（真红样：违例时判据必须报，正常时不许误报）。
 *
 * 全部走 parseSpecText / checkIndex / reconcile 的可注入入口 ——
 * 只有真实 8 份专项 prose 的话，红样无从写起，测的就只是「文件读得动」。
 */
import { describe, expect, it } from 'vitest'

import {
  checkIndex,
  collectSurface,
  parseSpec,
  parseSpecText,
  reconcile,
  summarize,
} from '../metrics-index.mjs'
import { parseDetailRows } from '../../v3-guard/lib/appendix-rows.mjs'

const OK = `## 第一部分：数据来源审查

### 指标 1.1：入口清单

**指标名称**：入口清单
**检查目标**：确认入口都被登记
**为什么需要检查**：漏登记则覆盖面不可知
**检查范围**：\`tools/audit-kit/metrics-index.mjs\`
**检查方法**：

1. \`grep -rn "fetch" tools/audit-kit\`

**需要查看**：源码
**正常标准**：清单完整
**异常情况**：存在游离入口
**风险等级**：P1
**整改方向**：补登记
**验收标准**：清单与 grep 一致

### 指标 1.2：返回点清单

**指标名称**：返回点清单
**检查目标**：确认返回点都被登记
**为什么需要检查**：同上
**检查范围**：\`tools/audit-kit\`
**检查方法**：
1. 逐文件读
**需要查看**：源码
**正常标准**：完整
**异常情况**：有遗漏
**风险等级**：P2
**整改方向**：补
**验收标准**：一致
`

const rows = (body) => `### 专项1\n${body}`

describe('metrics-index — 解析（阳性对照：好输入必须解出好结果）', () => {
  it('按「第X部分」定部分号，按「指标 N.M」定条目，11 字段齐全则无缺失', () => {
    const es = parseSpecText('docs/根基文档/审查体系专项/专项1-测试.md', '1', OK)
    expect(es).toHaveLength(2)
    expect(es[0].id).toBe('专1-1.1')
    expect(es[0].部分).toBe(1)
    expect(es[0].部分标题).toBe('数据来源审查')
    expect(es[0].风险等级).toBe('P1')
    expect(es[1].风险等级).toBe('P2')
    expect(es.flatMap((e) => e.缺失字段)).toEqual([])
  })

  it('检查方法里的命令 ⇒ auto-candidate，无命令但有可核面 ⇒ static', () => {
    const es = parseSpecText('x/专项1-a.md', '1', OK)
    expect(es[0].可执行性).toBe('auto-candidate')
    expect(es[1].可执行性).toBe('static')
  })

  it('附录区之后的指标带隔离标记（答案册不得混进正文判据面）', () => {
    const es = parseSpecText(
      'x/专项1-a.md',
      '1',
      `${OK}\n## 附录 A：判例库\n\n### 指标 2.1：判例\n\n**指标名称**：判例\n`
    )
    const inAppendix = es.find((e) => e.文内编号 === '2.1')
    expect(inAppendix.落在附录区).toBe(true)
    expect(inAppendix.附录隔离).toBe(true)
  })
})

describe('metrics-index — checkIndex 真红样', () => {
  it('撞号必红：同专项两条 1.1（专项1 第八/九部分撞号就是这一形态）', () => {
    const dup = OK.replace('### 指标 1.2：返回点清单', '### 指标 1.1：返回点清单')
    const { problems } = checkIndex(parseSpecText('x/专项1-a.md', '1', dup))
    expect(problems.some((p) => p.includes('ID 撞号') && p.includes('专1-1.1'))).toBe(true)
    expect(summarize(parseSpecText('x/专项1-a.md', '1', dup)).撞号数).toBe(1)
  })

  it('不撞号不许红（同形态阳性对照）', () => {
    const { problems } = checkIndex(parseSpecText('x/专项1-a.md', '1', OK))
    expect(problems.filter((p) => p.includes('撞号'))).toEqual([])
  })

  it('缺字段必红；标签被 markdown 转义成 \\*\\* 也算缺（专5-2.4 的真实形态）', () => {
    const missing = OK.replace('**异常情况**：存在游离入口', '')
    const escaped = OK.replace('**异常情况**：存在游离入口', '  **异常情况\\*\\*：存在游离入口')
    expect(
      checkIndex(parseSpecText('x/专项1-a.md', '1', missing)).problems.some(
        (p) => p.includes('字段缺失') && p.includes('异常情况')
      )
    ).toBe(true)
    expect(
      checkIndex(parseSpecText('x/专项1-a.md', '1', escaped)).problems.some(
        (p) => p.includes('字段缺失') && p.includes('异常情况')
      )
    ).toBe(true)
  })

  it('证据面断链必红：指向不存在的目录（backend/nest 型腐烂）', () => {
    const stale = OK.replace('`tools/audit-kit/metrics-index.mjs`', '`backend/nest/src/`')
    const es = parseSpecText('x/专项1-a.md', '1', stale)
    expect(es[0].面.missing).toContain('backend/nest/src/')
    expect(
      checkIndex(es).problems.some((p) => p.includes('证据面断链') && p.includes('专1-1.1'))
    ).toBe(true)
  })

  it('`feat/fix/docs/chore` 这类夹在词里的路径不算断链（防误红）', () => {
    const prose = OK.replace(
      '**检查范围**：`tools/audit-kit/metrics-index.mjs`',
      '**检查范围**：commit 规范（feat/fix/docs/chore 等）'
    )
    expect(
      checkIndex(parseSpecText('x/专项1-a.md', '1', prose)).problems.filter((p) =>
        p.includes('断链')
      )
    ).toEqual([])
  })
})

describe('metrics-index — 与附录 §8 对账', () => {
  const es = parseSpecText('x/专项1-a.md', '1', OK)

  it('附录用 ′ 区分增补条目 ⇒ 归一后全等，不许误报', () => {
    const appendix = rows('| 1.1′ | 入口清单 | P1 | C |\n| 1.2′ | 返回点清单 | P2 | C |\n')
    expect(reconcile(es, appendix).problems).toEqual([])
  })

  it('正文有条目而附录无 ⇒ 必红（两本账不许各自漂移）', () => {
    const appendix = rows('| 1.1 | 入口清单 | P1 | C |\n')
    const { problems } = reconcile(es, appendix)
    expect(problems.some((p) => p.includes('1.2：正文有、附录无'))).toBe(true)
  })

  it('等级两本账不一致 ⇒ 必红', () => {
    const appendix = rows('| 1.1 | 入口清单 | P0 | C |\n| 1.2 | 返回点清单 | P2 | C |\n')
    expect(reconcile(es, appendix).problems.some((p) => p.includes('等级不一致'))).toBe(true)
  })

  it('🔴 改附录名称 ⇒ 必红（专3-F-02：名称列此前无执行体，改名三闸全绿）', () => {
    const renamed = rows('| 1.1 | 改名探针 | P1 | C |\n| 1.2 | 返回点清单 | P2 | C |\n')
    expect(reconcile(es, renamed).problems.some((p) => p.includes('名称不一致'))).toBe(true)
    // 阳性对照：同批同形态、名称一致 ⇒ 零 problems（不许把正确项误红）
    const ok = rows('| 1.1 | 入口清单 | P1 | C |\n| 1.2 | 返回点清单 | P2 | C |\n')
    expect(reconcile(es, ok).problems).toEqual([])
  })

  it('删掉正文一条指标 ⇒ 总数不等必红（第 1 式：删字面）', () => {
    const one = parseSpecText('x/专项1-a.md', '1', OK.slice(0, OK.indexOf('### 指标 1.2')))
    const appendix = rows('| 1.1 | 入口清单 | P1 | C |\n| 1.2 | 返回点清单 | P2 | C |\n')
    expect(reconcile(one, appendix).problems.some((p) => p.includes('总数不一致'))).toBe(true)
  })
})

describe('metrics-index — 真实仓库回归（钉住 09-26 收口的三件事）', () => {
  const real = parseSpec()

  it('正文条数 = 附录 §8 条数（两处必须相等；加/删指标由这条关系兜住，不抄绝对数）', () => {
    const 附录条数 = [...parseDetailRows().values()].reduce((n, l) => n + l.length, 0)
    expect(real.length).toBe(附录条数)
    expect(real.length).toBeGreaterThan(300) // 解析塌缩兜底
    expect(new Set(real.map((e) => e.专项)).size).toBe(8)
  })

  it('撞号 0（专项1 两个「第八部分」已于 2026-09-26 改为第八/第九）', () => {
    expect(summarize(real).撞号数).toBe(0)
    expect(real.filter((e) => e.专项 === '专项1' && e.部分 === 9)).toHaveLength(5)
  })

  it('证据面断链 0（v3 迁移遗留的 backend/nest 等死路径已清）', () => {
    expect(summarize(real).断链指标数).toBe(0)
    expect(real.some((e) => /backend\/nest/.test(`${e.检查范围}${e.需要查看}${e.检查方法}`))).toBe(
      false
    )
  })

  it('11 字段齐全（含曾被 prettier 转义吞掉标签的 专5-2.4）', () => {
    expect(summarize(real).缺字段数).toBe(0)
    expect(real.find((e) => e.id === '专5-2.4').缺失字段).toEqual([])
  })

  it('collectSurface 只报真实存在的落点（活路径判据）', () => {
    const s = collectSurface({ 检查范围: '`tools/v3-guard/run-all.mjs` 与 `backend/nest/src/`' })
    expect(s.paths).toContain('tools/v3-guard/run-all.mjs')
    expect(s.missing).toContain('backend/nest/src/')
  })
})
