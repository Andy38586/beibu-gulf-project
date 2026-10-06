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
  collectSurfaceFromText,
  parseSpec,
  parseSpecText,
  reconcile,
  scanExtraDocSurface,
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

describe('metrics-index — Q8-01 证据面断链不再假绿（多根解析 + 整树删除 + 附录/约定）', () => {
  it('@guard-red-sample 整树已删（父目录也没了）必须进 missing（旧实现静默丢弃）', () => {
    const s = collectSurfaceFromText('backend/src/modules/site-analysis/services/scoring.ts')
    expect(s.missing).toEqual(['backend/src/modules/site-analysis/services/scoring.ts'])
  })

  it('@guard-red-sample 模块相对写法必须多根解析：旧 site-analysis 报 missing、现役文件判活', () => {
    const dead = collectSurfaceFromText('modules/site-analysis/services/scoring.ts')
    expect(dead.missing).toEqual(['modules/site-analysis/services/scoring.ts'])
    const alive = collectSurfaceFromText('modules/site-suitability/services/scoring.ts')
    expect(alive.paths).toEqual(['modules/site-suitability/services/scoring.ts'])
  })

  it('@guard-red-sample 目录在但文件缺 ⇒ missing（原行为保留）', () => {
    const s = collectSurfaceFromText('backend/src/modules/site-suitability/services/nonexistent.ts')
    expect(s.missing).toEqual(['backend/src/modules/site-suitability/services/nonexistent.ts'])
  })

  it('防误报：文字并列（ECharts/Chart.js、main.ts/main.js）首段不是目录 ⇒ 不判', () => {
    const s = collectSurfaceFromText('ECharts/Chart.js 与 main.ts/main.js 二选一')
    expect(s.missing).toEqual([])
    expect(s.paths).toEqual([])
  })

  it('回归锚：当前 403 条指标 + 附录/约定证据面零断链（真树）', () => {
    const { problems } = checkIndex(parseSpec())
    expect(problems.filter((p) => p.includes('证据面断链'))).toEqual([])
    expect(scanExtraDocSurface()).toEqual([])
  })

  it('@guard-red-sample 附录/约定纳入判据面：约定里加一条死路径 ⇒ 必报', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const fakeRoot = mkdtempSync(join(tmpdir(), 'q801-'))
    const dir = join(fakeRoot, 'docs/根基文档/审查体系专项')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '审查体系约定.md'), '见 `docs/根基文档/审查体系专项/NoSuch.md`\n')
    const problems = scanExtraDocSurface(fakeRoot)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('NoSuch.md')
  })
})

describe('metrics-index — QC-05 环境产物不进判据面（工作树/干净检出同口径）', () => {
  it('@guard-red-sample node_modules token 归环境面：目录不存在也不进 missing（删豁免 ⇒ 本用例红）', () => {
    // root 指向不存在的目录 = 模拟干净检出（没装依赖）。
    // 若去掉 ENV_DEPENDENT_RE 的形态识别，node_modules/ 会掉进 missing ⇒ 本用例当场红。
    const s = collectSurfaceFromText(
      '**需要查看**：`package.json`、`node_modules/@types`、自定义 `.d.ts`',
      '/no-such-root-qc05'
    )
    expect(s.env).toEqual(['node_modules/'])
    expect(s.missing).toEqual([])
  })

  it('grep 过滤词里的 node_modules（专项8 形态）同样归环境面，兄弟路径不受影响', () => {
    const s = collectSurfaceFromText(
      "grep -rn 'Math.random' backend frontend/src | grep -v 'node_modules|test'"
    )
    expect(s.env).toEqual(['node_modules'])
    expect(s.paths).toEqual(['backend', 'frontend/src'])
    expect(s.missing).toEqual([])
  })

  it('真树锚：环境面 4 条（node_modules ×2 / dist / .local 临时件），且断链 0', () => {
    const es = parseSpec()
    expect(es.filter((e) => e.面.env.length).map((e) => e.id)).toEqual([
      '专1-9.1',
      '专3-7.3',
      '专5-3.5',
      '专5-5.3',
    ])
    expect(summarize(es).断链指标数).toBe(0)
    // 环境面不算「有可核面」：这两条的可执行性不因本机装没装依赖而翻面
    expect(es.find((e) => e.id === '专3-7.3').可执行性).toBe('manual')
    // dist 在工作树存在时曾把 专5-3.5 判成 static；环境面移出后必须回落 manual（跨口径一致）
    expect(es.find((e) => e.id === '专5-3.5').可执行性).toBe('manual')
  })
})
